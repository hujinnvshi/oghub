---
title: 昇腾 910 上 MiniCPM-o 4.5 的“6 帧 NaN 退化”根因定位（仅诊断、非破坏）
description: 在 Atlas 800T A3 上对一个已知 bug 做非破坏式根因定位——MiniCPM-o 4.5（llama.cpp-omni / ggml-cann）多模态帧数 ≤5 全对、≥6 输出全空。用 env 门控的诊断打印（OMNI_DEBUG_LOGITS/NAN）抓到：NaN 首次出现在 6 帧 decode 首个 token（n_past=541，maxlogit=nan），而 5 帧 n_past=474 仍正常；vision embedding 全程 emb_nan=0、--temp 0 确定性下仍 NaN → 根因在 LLM 侧长上下文前向数值溢出，与 flash_attn 被 CANN 强制关闭强相关。全程不改源码/binary，跑后 sha256 三 CLI 全 OK。
pubDate: 2026-08-12
---

之前在这台机器上验证 MiniCPM-o 4.5(llama.cpp-omni / ggml-cann)时撞到一个怪 bug:**多模态帧数 ≤5 全对,≥6 帧输出全是空字符串**。这篇用非破坏式手段把它的根因定位到具体位置——**只诊断、不改源码、不修复**(修复另开分支)。

运行环境:**Atlas 800T A3 · Ascend910_9382 die0 · CANN 9.1.0-beta.1 · MiniCPM-o 4.5 F16**。

---

## 一、方法:env 门控诊断,零源码改动

`libomni.so` 里预埋了诊断打印,默认关,用环境变量打开:
```
OMNI_DEBUG_LOGITS=1 OMNI_DEBUG_NAN=1 python diag_rootcause.py [N1] [N2] [NQ]
```
- `[DBGLOGITS]` 打每个 decode token 的 `n_past / argmax / maxlogit / p_argmax`。
- `[DBGNAN]` 打 prefill 各 embed 点的 `emb_nan`(vision 侧是否有 NaN)。

诊断只是"调用现成 binary + 数据",**不改源码**。非破坏证据:跑前跑后对 binary 做 `sha256sum -c bin-sha256.txt`,三 CLI 全 OK(见末尾)。

## 二、阈值复现:5✅ / 6❌(精确)

| 帧数 | 正确率 | 输出 |
|---|---|---|
| **5** | 2/2 ✅ | Pred='C' / 'A'(正常) |
| **6** | 0/2 ❌ | Pred='' / ''(全空,退化) |

## 三、根因定位:NaN 首爆在 6 帧 decode 第一个 token

对比 5 帧(正常)与 6 帧(退化)的诊断行:

| | 末尾正常 / 首个 NaN | maxlogit |
|---|---|---|
| **5 帧** | `n_past=474 tok#0 argmax='C'` | **30.156**(正常) |
| **6 帧** | `n_past=541 tok#0 argmax=0 '!'` | **nan**(首爆) |

- 5 帧的 decode 在 `n_past=474` 仍完全正常(maxlogit=30.156)。
- 6 帧 decode **第一个 token(`n_past=541`)就已经 NaN**,其后所有 token 全 NaN。
- → **NaN 在第 6 帧 prefill 期间产生**(n_past 从 ~478 推到 ~540,多出 1 帧 ≈ 66 token),decode 一启动就全是 NaN。

**两个判据锁定根因范围**:
1. `prefill_emb emb_nan=0`(全程)→ **vision 侧干净,NaN 不来自视觉编码器**。
2. `--temp 0.0`(确定性)下仍 NaN → **是前向数值溢出,不是采样随机性**。

→ **根因在 LLM 侧:长上下文(~541 token)前向计算溢出**。

## 四、根因假设排序(数据指向,未逐层证实)

1. **【最可能】fp16 注意力无 flash-attn 溢出**。ggml-cann 因 CANN 不兼容**强制关闭 flash_attn**(见 [KV-cache 监控](./ascend-npu-kv-cache-monitoring)),attention 走 fp16 全 `QK^T + softmax`。上下文到 ~540 时,pre-softmax 点积或 softmax 指数项溢出 fp16(`max≈65504`)→ NaN。这能解释"为什么恰好 6 帧(≈540 token)是悬崖"。
2. 长上下文 RoPE fp16 退化(可能性低——RoPE 是 elementwise,不易悬崖式溢出)。
3. KV 累积精度漂移(可能性低——应是渐变,而非 6 帧精确悬崖)。

> 注意对比:Track 2 里 torch_npu 自带融合 `aclnnFlashAttentionScore`(flash-attn 可用),而 **ggml-cann 没有**——同一片 910,两套后端算子覆盖差异,正是这类 bug 的温床。

## 五、结论

- ✅ 精确复现 5✅/6❌;NaN 首爆在 **6 帧 decode 首个 token n_past=541**,5 帧 n_past=474 仍正常。
- ✅ **根因在 LLM 侧长上下文前向数值溢出**;vision 无关、非采样;与 **flash_attn 缺失**强相关。
- ⚠️ **仅诊断**:未改源码/binary,逐层 op 级证实(需 msprof + 改 ggml-cann 加层探针)留作后续;修复需另开分支(给 ggml-cann 实现 flash-attn 或 attention fp32 累加)。
- 💡 教训:**框架级 "flash_attn forced off" 不只是性能问题,也可能是长上下文数值稳定性的直接原因**——排查精度悬崖时先看 attention 精度路径。

## 六、复现 + 非破坏证据

```bash
source /usr/local/Ascend/ascend-toolkit/set_env.sh; export CUDA_VISIBLE_DEVICES=0
CK=.../benchmark/video-mee-cookbook
# 阈值复核:
( cd $CK && python .../verify-ascend-2026-08-10/diag/diag_frames.py "5,6" 2 )
# 根因(抓 DBGNAN/DBGLOGITS):
( cd $CK && OMNI_DEBUG_LOGITS=1 OMNI_DEBUG_NAN=1 OMNI_DIAG_OUT=./out python diag/diag_rootcause.py 5 6 1 )
# 非破坏校验(诊断前后都应全 OK):
sha256sum -c .../verify-ascend-2026-08-10/stage2/bin-sha256.txt
# → llama-omni-cli:OK / -eval-cli:OK / -perf-duplex:OK
```
