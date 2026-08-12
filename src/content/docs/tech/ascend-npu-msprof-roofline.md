---
title: 用 msprof 剖析昇腾 910 的 matmul 与 transformer：算子链、AICore 占空比与 Roofline
description: 在 Atlas 800T A3 上用 CLI msprof 和 torch_npu.profiler 两条工具链剖析 matmul 与 12 层 transformer 前向——还原 torch op → aclnn → AICore 链路（aten::matmul → aclnnMatmul → 24 cube 核），实测 matmul 折算 298 TFLOPS≈算力打满、HBM 利用率仅 0.2%（纯计算受限）；transformer 分解出 34.6% 是 matmul、7% 是 aclnnFlashAttentionScore；并用实测数据画出 910 的 Roofline（matmul 顶到算力天花板、softmax 落在带宽斜线）。
pubDate: 2026-08-12
---

前面测了这台 Atlas 800T A3 的算力/带宽(见[核查与基准](./atlas-800t-a3-env-check-and-npu-bench))。但"293 TFLOPS"只是个结果数——**这些算力到底是怎么花掉的、卡在算力还是带宽上、每个 torch 算子映射到 NPU 哪个内核**,得用 profiler 拆开看。这篇用 msprof 把 matmul 和一个 transformer 前向剖析到内核级,并画出 910 的 Roofline。

运行环境:**Atlas 800T A3 · Ascend910_9382 die0 · CANN 9.1.0-beta.1 · torch 2.12 + torch_npu 2.12**。

---

## 一、两条剖析工具链

| 工具 | 用法 | 产物 |
|---|---|---|
| **CLI `msprof`** | `msprof --output=prof --application="python target.py" --ai-core=on --aic-metrics=Memory --duration=120` | `op_summary_*.csv`(每算子 aicore_time、cycles、各级带宽) |
| **Python `torch_npu.profiler`** | `profile(activities=[CPU,NPU], schedule=..., on_trace_ready=...)` | `kernel_details.csv`、`operator_details.csv`、`trace_view.json` |

> 坑① `torch_npu.npu.profile` 不存在,正确是 `torch_npu.profiler.profile`;`tensorboard_trace_handler`(无下划线)。
> 坑② CLI msprof 的 `--storage-limit` 取值有范围限制(误传 500 报错),去掉它靠 `--duration` 控量。
> 坑③ `--application` 启动的 app 含 torch_npu import(~90s),`--duration` 要给足(我用 120s)才采到稳态。

## 二、matmul 剖析:torch op → aclnn → AICore 全链

Python profiler 的 `operator_details.csv` 直接给出链路:

```
aten::matmul  →  aclnnMatmul  →  内核 aclnnMatmul_MatMulV3Common_MatMulV3
(Device Total Duration 3725 us)
```

CLI msprof 的 `op_summary.csv` 给出该内核的硬件指标(30955 次采样):

| 指标 | 实测 | 含义 |
|---|---|---|
| 执行单元 / Block Num | **AI_CORE / 24** | 24 个 cube 核全用上(= 设备参数) |
| aicore_time(中位) | **3685.8 us** | 单次 matmul 内核耗时 |
| 折算算力 | **298.3 TFLOPS** | ≈ 实测峰值 293 的 **~100%** |
| HBM r+w 带宽 | **2.1 GB/s** | 仅峰值 1.27 TB/s 的 **0.2%** |

→ **matmul 在 910 上把 cube 算力几乎打满,但几乎不读 HBM**(数据在 L1/L2 里复用)。这是教科书级的**计算受限 GEMM**:优化它只能靠提算力或改算法,省带宽没用。

## 三、transformer 前向分解(12 层 Llama,bf16,4×512)

把一个 transformer forward 的 NPU kernel 按耗时聚合(总 40.14 ms):

| aclnn 内核 | 占比 | 对应 |
|---|---|---|
| **aclnnMatmul** | **34.6%** | QKV/O 投影、MLP up/down |
| aclnnMul | 13.9% | elementwise(RoPE 旋转 / attention scale) |
| **aclnnFlashAttentionScore** | **7.0%** | 注意力(SDPA 的融合 flash-attn 内核) |
| aclnnNeg/Cat(Transpose) | 4.7/4.2% | 数据重排 |
| aclnnAdd / Cast / Mean / Pow / Silu / Triu / Slice | 其余 | 残差、cast、rmsnorm、激活、causal mask |

**三点观察**:
1. **matmul 占 1/3**——transformer 的时间主要花在线性层,优化重点在 GEMM 算力。
2. **elementwise(Mul/Add/Cast 等)加起来 ~30%**——这些是 launch 开销敏感的小算子,放大 batch / 算子融合能省。
3. `scaled_dot_product_attention` 映射到 **`aclnnFlashAttentionScore`(融合 flash-attn)**。注意:这和 [KV-cache 监控](./ascend-npu-kv-cache-monitoring)里 llama.cpp/ggml-cann 的 `flash_attn 被强制关闭`不同——**torch_npu 自带融合 flash-attn,ggml-cann 没有**,两套后端算子覆盖差异很大。

## 四、Roofline:谁卡在算力、谁卡在带宽

用 Track 1 的实测数据画 910 的 Roofline(峰值算力 293 TFLOPS fp16、峰值带宽 1.27 TB/s,拐点 AI≈231 FLOP/byte):

| 算子 | 算术强度 AI(FLOP/byte) | 实测吞吐 | 落点 |
|---|---|---|---|
| **softmax** | 6.3 | ~1.45 TB/s | **带宽斜线**(访存受限) |
| **matmul** | 2731 | 292 TFLOPS | **算力天花板**(打满) |
| sdpa | 2554 | 48 TFLOPS | 计算区但未达峰(内核效率) |
| conv2d | 6695 | 146 TFLOPS | 计算区但未达峰 |

→ Roofline 把"为什么 matmul 是 292T 而 sdpa 只有 48T"解释清楚了:**matmul 顶到了算力天花板,sdpa/conv2d 虽然也在计算区但内核效率不到峰值的 1/3**——这是后续优化的空间(算子融合 / 更优 kernel),不是带宽问题。

## 五、结论

- ✅ msprof 能完整还原 **torch op → aclnn → AICore** 链;matmul 用满 24 cube 核、~100% 算力、0.2% 带宽(纯计算受限)。
- ✅ transformer 时间 **34.6% 在 matmul、7% 在 flash-attn**;优化重点是 GEMM 算力 + 算子融合。
- 💡 **torch_npu 有融合 flash-attn(aclnnFlashAttentionScore),ggml-cann 没有**——同片硅、不同后端能力差很大,选推理引擎时要注意。
- 💡 Roofline 定位瓶颈:matmul 已到顶,要再快得靠算法;sda/conv2d 还有 ~2-3x kernel 效率空间。

## 六、复现

```bash
source /usr/local/Ascend/ascend-toolkit/set_env.sh; export ASCEND_RT_VISIBLE_DEVICES=0
# CLI msprof:
msprof --output=prof_matmul --application="$PY target_matmul.py" --ai-core=on --aic-metrics=Memory --duration=120
# Python profiler:
python target_matmul_prof.py        # → kernel_details.csv / operator_details.csv / trace_view.json
python roofline.py                  # → roofline.svg(无 matplotlib 依赖)
```
