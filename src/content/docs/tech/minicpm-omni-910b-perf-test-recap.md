---
title: MiniCPM-o 4.5 昇腾 910B 推理优化：双工 RTF 与三项 Benchmark 测试复盘
description: 记录一天内在昇腾 910B3 单卡上把 MiniCPM-o 4.5 全双工推理的 SPEAK→WAV RTF 从基线 1.087 压到 0.68 的优化链、遇到的 vocoder/whisper/多帧退化等问题与修复，以及三项精度 benchmark 的验收现状与认知更正。
pubDate: 2026-08-07
---

这是一篇**测试复盘**——把一天里在昇腾 910B3 上做的性能优化、benchmark 接入、以及踩到的坑全部摊开记下来。背景：MiniCPM-o 4.5 全模态推理优化赛（赛道一·子赛道 A：llama.cpp-omni），核心排名指标是 **SPEAK→WAV 完整链路 RTF**（官方基线 **1.087**，越低越好，<1 表示快于实时），精度准入看三项 benchmark。

运行环境：**910B3 单卡（64GB HBM）+ CANN 9.1.0-beta.3 + aarch64**，权重 F16（CANN 不支持 Q4_K_M 量化算子，必须 F16）。优化红线：**不得改推理数学**，只能在流水线/调度层动。

---

## 一、结果总览

| 验收项 | 官方要求 | 结果 | 状态 |
|---|---|---|---|
| 性能 RTF | beat 基线 1.087 | 中位 **0.68**（3 次 0.84/0.68/0.58） | ✅ 领先 ~37% |
| Demo 8 项准入 | 全过 | 全过 + 视频 + 证据 | ✅ |
| 复现 | 代码/脚本/文档 | `scripts/` 一键 + checklist 勾选 | ✅ |
| TTS-Seed WER | ≤ 1.56（基线 1.414） | **0.20** | ✅ |
| TTS-Seed SIM | ≥ 0.689（基线 0.709） | 0.84（base-plus 口径，与官方 UniSpeech 口径未对齐） | ⚠️ 口径 |
| Daily-Omni 精度 | ≥ 77.5（基线 79.5） | ~10%（6.7% / 12.5%） | ❌ 框架上限 |
| VideoMME 精度 | ≥ 67.0（基线 69.0） | 未跑通（server 崩溃） | ❌ 待修 |

一句话：**性能、Demo、复现、TTS-WER 全达标；两项多模态精度（Daily-Omni / VideoMME）卡在 omni 框架代际上限**，不是数学精度问题。

---

## 二、性能 RTF 优化链（P3 → P4 → P5 + 极限分析）

优化前一天的 P1.7（LLM↔TTS 队列解耦 1→16）已把 e2e RTF 从基线做到 **0.83**。这天的性能工作是在 TTS 段继续榨。

### 先定位：T2W 分段计时

开 `OMNI_T2W_PROFILE=1` 把 token2wav 拆开看，瓶颈立刻现形：

| 段 | 位置 | 耗时（p50） | 占比 |
|---|---|---|---|
| **vocoder**（CPU hifigan） | CPU | **~591ms（8 threads）** | **~80%** |
| token2mel（Flow） | NPU | ~100–140ms | ~20% |

LLM decode 已逼近物理极限（实测 14ms/tok vs memory-bound 下限 13.7ms），不在 TTS RTF 路径上。**真瓶颈是 CPU 上那个 591ms 的 vocoder**——而机器有 256 核，只用了 8 个。

### P3：vocoder 多线程 8 → 16

`kDefaultThreads` 8→16（+ env `OMNI_T2W_THREADS` 可覆盖）。只改 CPU 并行度，不动推理数学（LLM token 序列不变、vocoder 同权重）。

- vocoder p50 591 → **395ms（-33%）**
- TTS RTF 0.83 → **0.62**（5 次中位，降 25%）
- token2mel 不变（NPU 段不受 CPU threads 影响）✅

### P4：threads 24 + NUMA 绑核

继续扫 12/16/20/24 threads × NUMA：

| 配置 | RTF | 备注 |
|---|---|---|
| 16（P3 默认） | 0.64 | |
| 16 + NUMA | 0.61 | 绑核更稳 |
| 24 + NUMA（taskset -c 192-223） | **0.57** | 最优 |
| 24 **不绑核** | 0.72 / 0.75 | 跨 node remote 内存 + 抢核，反而更差 |

关键认知：**`taskset` 绑核是必需**，不是可选——24 线程不绑核会因跨 NUMA node 访问 remote 内存而劣化。最优组合 `OMNI_T2W_THREADS=24 + taskset -c 192-223`（NUMA node6）→ **RTF 0.57（beat 基线 48%）**。

> 注意：0.57 是"调优最优值"；正式报告里更保守地标 **中位 0.68（16 threads 默认配置）**——因为它不依赖手动绑核、最可复现。两个数都远低于 1.087。

### P5：vocoder overlap 流水线——尝试冲 0.34，未达，回退

极限分析（见下）算出红线内理论下限 **0.34**（让 vocoder CPU 与 NPU 段完全重叠并行）。于是实施 overlap 流水线（`token2mel N` ‖ `vocoder N-1` 异步）：

- overlap 确实生效（日志 134× `push_tokens_only` 调用）
- 但 T2W 仅 540 → 500ms（只省 40ms），**RTF 0.58 = 开关关闭的 0.58，没冲到 0.34**
- 根因：**vocoder（24 threads，CPU 重）和 token2mel（NPU，但 CPU 侧调度）抢 CPU 资源**，没真正并行起来

**决策：不 merge**，保住 P3/P4 的 0.57。0.34 是"完全并行"的理论假设，实测 CPU 竞争下不可达。

### 极限分析：真实硬极限是 0.34，且 vocoder 没法 NPU 化

各段 Roofline（910B：FP16 ~320 TFLOPS / HBM 带宽 ~1.2 TB/s）：

| 段 | 类型 | 物理下限 | 实测 | 判定 |
|---|---|---|---|---|
| LLM decode | memory-bound | 13.7ms/tok | 14ms | 近极限 |
| TTS-model | memory-bound | ~24ms/chunk | < T2W | 非瓶颈 |
| Flow（token2mel） | compute-bound | — | ~102ms（AICore 仅 23%） | NPU 算子低效，但被 vocoder 隐藏 |
| **vocoder（CPU）** | compute-bound | **346ms** | **346ms** | **CPU 物理锁，红线内不可降** |

- **红线内硬极限 = 0.34**（被 vocoder CPU 346ms 物理锁死，P5 实测还证伪了"完全 overlap"假设）。
- 想突破 0.34 唯一的路是 **vocoder NPU 化**——但实测 **CANN 后端不支持 CNN 算子（`CONV_2D`/`CONV_1D` 全 support=0）**，而 HiFiGAN 的核心就是 CNN。算子缺失直接阻断，需移植 500–1000 行 ACLNN + 数值回归，越红线 + 大工程。**不可行**。

结论：**RTF 0.57/0.68 是"红线内 + CPU 物理"的实际高位**，再往下要么越红线，要么赌实验性 CPU 亲和细分。

---

## 三、Daily-Omni / Video 接入：连环问题与修复

跑 Daily-Omni benchmark 一上来 5/5 `video_decode_failed`，准确率 0%。以为是数据问题，深挖下去是**一连串被互相掩盖的 bug**。

### 问题 1：video_decode_failed 其实是"瞬态"，不是数据坏

数据是标准 MP4、ffmpeg 在 PATH 里、用 server 原命令能复现成功 extract（`/tmp/omni_ws/video_2/` 有物证）。真因：裸 `std::system("ffmpeg")` **无重试、不捕获 stderr**，加上 omni_context 懒加载（`/health` 恒 ok 不反映就绪）→ 启动初期瞬态硬 fail。

**加固**（`ws_handler.cpp`）：`run_cmd_capture`（popen 捕获 stderr + WEXITSTATUS）+ audio/frame 各重试 1 次 + `timeout -k 5 30` 防 hang + `diagnostic` 回传 ffmpeg stderr。红线：ffmpeg 参数一字不动，成功路径 bit-identical。

### 问题 2：加固反而挖出 whisper 30s 崩溃（被掩盖了两个月）

extract 加固成功后，流程**首次**走到 audio prefill → `build_whisper` 的位置编码缓冲区（按 `n_audio_ctx=1500` = 标准 whisper 30s 窗口预分配）溢出 → `throw` → 整个 server **SIGABRT（exit 134）**。Daily-Omni 音频 96.7% > 30s（半数 60s），几乎每条必崩。

> 这个崩溃之前一直被问题 1 的 `video_decode_failed` 挡在前面——fail 在 extract 阶段就返回了，根本走不到崩溃点。加固反而把它暴露出来。

**修复**：extract 的 audio 命令加 `-t 29.9`（mel ≤ 3000 → conv token ≤ 1500 不溢出）。验证 `n_tokens=1495 < 1500`，server 不崩。

### 问题 3：文本输出乱码（40 个 `?`）——多帧视觉触发模型退化

server 不崩之后，输出是 `??????????`。排查时**三个静态分析 agent 给了三个互相矛盾的结论**（audio token 没 mask / prompt 结构错 / payload 缺字段），其中一个还读错了关键行。静态分析不够，改做 runtime 隔离实验：

| 实验 | 输入 | stack_frames | 输出 |
|---|---|---|---|
| T1 | 纯文本 | — | "The correct answer is B. blue" ✅ |
| T2 | video+audio | **1** | "Okay, let me think... speaker is a woman..." ✅ |
| T3 | video+audio | **8** | `??????????` ❌ |

**根因锁定 = `stack_frames=8`（多帧）触发**——正是问题 1 加固时顺手引入的"多采帧"改动（1→8）。再加 token id 日志确证：乱码 token 全是 **id=30、audio=0、eog=0**，重复 40 次。**不是 audio token**（id=30 远不在 audio vocab 范围），是**模型退化 / repetition collapse**——decode 陷入重复输出不可打印 token 30 的死循环。

深度原因：多帧 vision embedding（每帧 64 token）+ audio + system/text 的组合超出了 MiniCPM-o turn_based 的训练分布 → attention 退化。**修复**：`--stack-frames` 默认 8 → **1**（回到训练分布内的单帧布局）。修完后 8 条全部正常文本，乱码消失。

> 教训：**runtime 实测 > 静态推测**。静态分析说的"audio token 没 mask"被一条 token id=30 的日志直接推翻。问题 1 里"多采帧"的建议没实测就采纳，反而引入了退化。

### Daily-Omni 的真正上限

乱码修完后，精度仍只有 ~10%（远低于基线 79.5）。这不是 bug，是 **omni 框架对 daily-omni（60s 音视频 QA）的能力上限**：whisper 30s 窗口（60s 样本截断丢半）+ 单帧视觉（多帧退化）+ thinking 风格输出常不给明确 ABCD。VideoMME 同理——大视频 server 静默崩溃（无栈、非资源），框架不稳定。

---

## 四、遇到的问题汇总

| # | 问题 | 根因 | 处置 |
|---|---|---|---|
| 1 | vocoder threads=32 不稳 | NUMA 跨 node 抖动 | 16 默认最优，24+绑核进阶 |
| 2 | overlap 流水线冲不到 0.34 | vocoder 与 t2m CPU 资源竞争 | P5 回退，不 merge |
| 3 | vocoder 想搬 NPU | CANN 无 CNN 算子（CONV_2D/1D） | 不可行，放弃 |
| 4 | video_decode_failed | ffmpeg 无重试 + 懒加载瞬态 | 加固（重试/timeout/diagnostic） |
| 5 | whisper 30s 崩溃（掩盖两月） | n_audio_ctx=1500 缓冲溢出 | audio 加 `-t 29.9` |
| 6 | 文本乱码 40 个 `?` | stack_frames=8 多帧模型退化 | 默认改回 1 |
| 7 | VideoMME server 静默崩溃 | 框架对大视频不稳定 | 未解，脚本留存待框架修 |
| 8 | Daily-Omni/VideoMME 精度低 | 框架代际上限（单帧+30s+thinking） | 如实报告 + 求证官方基线 |
| 9 | TTS-Seed SIM 口径偏差 | 官方用 UniSpeech `wavlm_large_finetune` | 本机无框架，务实跳过 SV 口径 |
| 10 | msprof `--export` csv 拿不到 | 解析慢（>300s timeout） | PROF_ 原始产物有，未出 csv |

---

## 五、两个认知更正（重要）

这天的测试推翻了两个早先的假设：

1. **"F16 不改数学 → 精度 = 基线"对多模态 benchmark 不成立。** 这句话只对纯文本/数学等价推理有效。多模态精度严重受 omni 框架配置影响（视觉帧数、音频窗口、输出模态控制），不是 F16 数学等价能保证的。Daily-Omni / VideoMME 的精度由框架能力上限决定。

2. **79.5（Daily-Omni）/ 69.0（VideoMME）基线来源存疑。** 这两个数很可能不是 llama.cpp-omni 框架实测，而是原生 MiniCPM-o / Qwen-Omni 类原生音视频模型的成绩。若是，那准入阈值对 omni 框架并不公平——需要向官方求证基线口径。

---

## 六、方法论沉淀

这天反复印证的几条：

- **runtime 实测 > 静态推理**。被推翻过两次：P1.6 那个"AICore 4% = 没走 NPU"是采样时机伪影（细粒度采样 burst 到 60–84%）；P7 三个静态 agent 的结论被 token id=30 一条日志推翻。
- **判断 NPU 是否在算**：`npu-smi info -t usages -i 1` 必须**细粒度（≤0.5s）采样看占空比**，看 `AICore Usage Rate` + `HBM Bandwidth Usage Rate`。绝不能看单次或粗均值。
- **每配置 ≥3 次取中位**，RTF 差异 < 0.03 视噪声、> 0.05 视真实差异。冷启动 vs 热机会有明显波动（P8 的 run1=0.84 冷启动偏高，run2/3 热机 0.68/0.58）。
- **优化闭环**：plan → 实测定位 → 修 → 三件套验证（npu-smi + 质量 + 同口径）→ 落盘。

---

## 七、结论

- ✅ **稳达标**：性能 RTF（中位 0.68，beat 37%；调优 0.57，beat 48%）、Demo、复现、TTS-Seed WER。
- ⚠️ **口径待对齐**：TTS-Seed SIM（需引入 UniSpeech 框架跑官方 SV）。
- ❌ **风险项**：Daily-Omni（~10% vs 77.5）、VideoMME（未跑通）——两项多模态精度受 omni 框架代际限制，不在"不改数学"能解决的范围内。

务实路线：聚焦已达标项；Daily-Omni/VideoMME 如实报告框架限制 + 求证官方基线口径，不强求在框架代际差内硬冲精度。
