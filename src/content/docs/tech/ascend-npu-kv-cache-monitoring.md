---
title: 昇腾 NPU 上 KV-cache 的监控方法与实测：以 MiniCPM-o 4.5 实跑为例
description: 在 Atlas 800T A3 上对一个正在跑的 MiniCPM-o 4.5 评测（llama.cpp-omni / CANN，n_ctx=40960）做非侵入式 KV-cache 监控——讲清昇腾上能看哪些 KV 指标（npu-smi HBM + 日志 n_past，本环境无 vLLM PagedAttention）、给出实测快照与时序、按公式估算 KV 容量（满窗 ~2.2 GB、当前仅用 ~11%），并指出 flash_attn 被 CANN 强制关闭、KV 预分配故 HBM 不随推理增长等关键现象。
pubDate: 2026-08-11
---

KV-cache 是大模型自回归推理绕不开的东西——它有多占内存、跑到哪了、瓶颈在不在它身上,直接影响吞吐和能开多大上下文。这台 Atlas 800T A3 上正好有个 **MiniCPM-o 4.5 的 VideoMME 评测在跑**(`llama.cpp-omni` / CANN 后端,`-c 40960`),趁机做一次**非侵入式 KV-cache 监控**(只读,不动推理进程),把方法、结果、分析、结论都记下来。

运行环境:**Atlas 800T A3 · Ascend910_9382 die0 · CANN 9.1.0-beta.1 · llama.cpp-omni(ggml-cann)**。

---

## 一、测试方法:昇腾上 KV-cache 能看什么?

昇腾没有 vLLM/MindIE 那种 PagedAttention 的 block/hit-rate 指标(llama.cpp 走连续 KV)。能非侵入拿到的 KV 信息有三个来源:

| 维度 | 方法 | 说明 |
|---|---|---|
| **KV 已用位置** | 日志 `grep n_past` | 直接看填充进度(每序列内累积,新问题重置) |
| **KV/权重总占用** | `npu-smi info` 看 die HBM | 含权重+KV+buffer;KV 预分配故 HBM 平稳 |
| **算力是否打满** | `npu-smi info -i 1 -c 0 -t usages` | AICore 占空比 |

**关键约束**:全程只读推理进程的日志和 npu-smi,**不启动新进程、不占 NPU、不改其产物**。附一个可复用脚本 `kv-monitor.sh`(定时采样 HBM/AICore/n_past/prefill)。

## 二、KV cache 配置(日志读到的实参)

| 项 | 值 | 说明 |
|---|---|---|
| `n_ctx` | **40960** | KV cache 窗口上限 |
| `flash_attn` | **OFF** | 日志:`flash_attn is not compatible with CANN - forcing off` |
| `n_keep` | 52 | system prompt 永驻,滑动窗口不驱逐 |
| KV 精度 | **fp16** | 未指定 `--cache-type-k/v`,默认 fp16 |
| KV 位置 | **NPU HBM** | `vision using CANN0 backend` + 7 个 davinci fd |
| `ngl` | 999 | 全部层 offload 到 NPU |

## 三、测试结果

**快照(18:01–18:03)**:die0 HBM **28322 MB / 65536(~27.7 GB,两次读数一致、平稳)**;AICore **77–82%**(满载推理);die1 HBM 2870 MB(idle 基线)。eval-cli 进程 CPU 68%、RSS ~2.3 GB(权重 mmap 在 HBM,RSS 偏低属正常)。

**6 样本时序(间隔 5s)**:

| time | n_past(峰值) | prefill 累计# |
|---|---|---|
| 18:02:55 | 4552 | 6533 |
| 18:03:01 | 4552 | 6563 |
| 18:03:07 | 4552 | 6615 |
| 18:03:13 | 4552 | 6664 |
| 18:03:19 | 4552 | 6739 |
| 18:03:25 | 4552 | 6794 |

→ prefill 稳步推进(~8/秒,任务正常),n_past 峰值稳定在 4552(64 帧问题的 KV 顶),HBM 平稳。

## 四、分析

### 4.1 KV 容量估算(按公式,标注为估算)

日志没直接打印 LLM 的 hparams,按 MiniCPM-o 4.5 的 Qwen2.5 级 LLM(GQA:28 层 / 4 KV head / head_dim 128)**估算**,给出公式便于重算:

- **每 token KV(fp16)** = 2(K+V) × n_layer × n_kv_heads × head_dim × 2 B ≈ 2×28×4×128×2 ≈ **56 KB/token**
- **满 40960 KV buffer** ≈ 40960 × 56 KB ≈ **2.2 GB**(fp16)
- 当前峰值 n_past=4552 → 实际用 ≈ 4552 × 56 KB ≈ **246 MB**(占满 buffer ~11%)

> ⚠️ 这是量级估算;精确值需 `--verbose` 或 profiling。但 HBM 实测总占 ~28.3 GB(权重+KV+buffer)是硬数据。

### 4.2 8 帧 vs 64 帧的 KV 消耗

每序列 n_past ≈ 52(system) + 帧数 × 66:

| 配置 | n_past | KV 用量 | 占 40960 |
|---|---|---|---|
| frames=8 | ~580 | ~31 MB | 1.4% |
| frames=64 | ~4276 | ~231 MB | 10.4% |

→ 64 帧 KV 消耗是 8 帧的 ~7.5 倍;即便如此 40960 窗口只用了 ~11%。

### 4.3 两个关键现象

1. **HBM 不随 n_past 增长 → KV 是预分配的**。llama.cpp 在 context 创建时按 `n_ctx=40960` 一次性占好 ~2.2 GB KV buffer,n_past 只反映"已用位置"而非"已分配"。**所以监控 KV 用量要看日志 n_past,看 HBM 只能看总量。**
2. **flash_attn 被 CANN 强制关闭**。注意:flash attention **不改变 KV cache 大小**,只省 attention 计算与峰值激活;关掉它 KV 不变,但长序列的 attention 计算开销更高(无 flash 优化)。

## 五、结论

- ✅ KV cache 在 **NPU HBM**(die0 ~28.3 GB 含权重+KV+buffer),AICore 满载,任务正常推进。
- ✅ KV **按 n_ctx 预分配**(~2.2 GB buffer),HBM 平稳;用量看 `n_past`,不看 HBM。
- ✅ 当前峰值 n_past=4552 仅占窗口 **~11%**——**KV 容量远未到顶,瓶颈在算力/带宽而非 KV**。
- ⚠️ **flash_attn 被 CANN 强制关闭**(标准 O(n²) attention,KV 大小不变但长序列算力更贵)。
- 💡 **处方**:这台机器跑长上下文,KV 容量很宽裕;要提吞吐应攻算力/带宽(参见本机 [算子画像](./ascend-npu-op-precision-matrix) ~300 TFLOPS、[NUMA 实验](./ascend-npu-numa-affinity-experiment) 用 pin_memory 喂数据),而非省 KV。

## 六、复现

```bash
# 非侵入监控(只读推理进程):
LOG=.../benchmark/video-mme-cookbook/log/cli_gpu0.log
watch -n5 "grep -oE 'n_past=[0-9]+' $LOG | tail -1; npu-smi info | grep 0000:99"
# 或用 kv-monitor.sh(定时采样 HBM/AICore/n_past/prefill 到表)
```
