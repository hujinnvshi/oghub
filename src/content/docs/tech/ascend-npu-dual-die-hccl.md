---
title: 昇腾 910 双 die 的 HCCL 集合通信实测：AllReduce 带宽、延迟与并行含义
description: 在 Atlas 800T A3 两颗 Ascend910 die（SIO 互联）上用 torchrun + torch.distributed(backend='hccl') 实测集合通信——AllReduce 峰值 ~105 GB/s（1GB）、小消息延迟 ~273us；对比 p2p 拷贝的 ~187 GB/s，AllReduce 约为裸链路的 56%（集合同步+reduce 开销）。并给出对双 die 并行的工程含义：TP 的 allreduce 是实打实的成本，应偏大算子/攒大消息或用 pipeline parallel 降低通信频率。
pubDate: 2026-08-12
---

双 die 协同,raw 链路带宽(p2p 拷贝 ~187 GB/s)只是一半——**真正多卡并行用的是集合通信(AllReduce/AllGather)**,它有算法开销和同步延迟。这篇把 HCCL 集合通信测出来,补上 [双 die 互联测试](./ascend-910-dual-die-interconnect-test) 里没覆盖的"集合通信"那一半。

运行环境:**Atlas 800T A3 · 2× Ascend910_9382 die(SIO 互联)· CANN 9.1.0-beta.1 · torch 2.12 + torch_npu 2.12**。

---

## 一、怎么跑 HCCL

- **后端**:用 `torch.distributed.init_process_group(backend="hccl")`。import torch_npu 时自动注册 hccl 后端。**坑:`torch_npu.hccl` 这个属性不存在**(会 KeyError),别去找它。
- **启动**:`torchrun --nproc_per_node=2 --master_port=29501 hccl_allreduce.py`,每 rank `torch.npu.set_device(rank)`。
- 前置:`source set_env.sh`、`ASCEND_RT_VISIBLE_DEVICES=0,1`、`HCCL_CONNECT_TIMEOUT=300`(防初始化卡死)。
- 每档 warmup 10 + 测 20 取中位,`torch.npu.synchronize()` 计时,`try/finally: destroy_process_group()`。

## 二、AllReduce 实测(2 die,fp16)

| 消息 | 中位延迟 | msg 带宽 | 算法带宽(2*(N-1)/N,N=2→1.0)|
|---|---|---|---|
| **1 KB** | **272.7 us** | — | —(看延迟) |
| 64 MB | 0.83 ms | 77.2 GB/s | 77.2 GB/s |
| 256 MB | 2.66 ms | 96.4 GB/s | 96.4 GB/s |
| **1024 MB** | 9.74 ms | **105.1 GB/s** | **105.1 GB/s** |

→ 大消息(1GB)逼近 **~105 GB/s**;带宽随消息增大爬升(小消息延迟主导)。

## 三、对比:p2p 187 vs AllReduce 105

| 量 | 值 | 说明 |
|---|---|---|
| p2p 拷贝(die→die) | ~187 GB/s | 裸 SIO 链路(见[互联测试](./ascend-910-dual-die-interconnect-test)) |
| **HCCL AllReduce** | **~105 GB/s** | 集合通信实测 |
| 占链路比 | **~56%** | AllReduce 在 p2p 之上多了 reduce 计算 + 同步开销 |
| HBM 本地带宽 | ~1.27 TB/s | AllReduce(~105)只有 HBM 的 ~8% |
| 1KB 延迟 | ~273 us | 集合同步启动开销,偏高 |

→ **集合通信带宽(~105 GB/s)远低于 HBM(1.27 TB/s)**:跨 die allreduce 是实打实的成本,不能忽略。

## 四、对双 die 并行的含义

AllReduce 带宽 ≈ 105 GB/s、而单 die 算力 ≈ 293 TFLOPS(fp16)。算个账:一次 TP 后的 allreduce 传输 N 字节,等价于让 N 字节的数据走 105 GB/s 的"慢通道",而同期 die 能算 293 TFLOPS。

- **Tensor Parallel 可行但要算清 comm/comp 比**:TP 每层后 allreduce 激活(~batch×seq×hidden)。若激活小、算子大(大 matmul),通信被计算隐藏;若频繁 allreduce 小张量,**273us 延迟 + 105GB/s 会吃掉收益**。
- **优先级**:大模型跨 die,**Pipeline Parallel(通信少而大)通常优于纯 TP(通信频繁)**;数据并行(梯度 allreduce 每步一次、消息大)也很合适。
- **攒大消息**:小消息(<64MB)带宽只有 77 GB/s,要尽量合并到 ≥256MB 才接近峰值。

## 五、结论

- ✅ HCCL 在 2 颗 SIO die 上可用(`backend='hccl'`),AllReduce 峰值 **~105 GB/s**、1KB 延迟 ~273us。
- ✅ AllReduce 约为裸 p2p 链路(187 GB/s)的 **56%**,集合开销明显。
- 💡 跨 die 通信(~105 GB/s)远低于 HBM(1.27 TB/s)→ **双 die 并行优先 pipeline/大消息数据并行,慎用频繁小 allreduce 的纯 TP**。

## 六、复现

```bash
source /usr/local/Ascend/ascend-toolkit/set_env.sh
export ASCEND_RT_VISIBLE_DEVICES=0,1 HCCL_CONNECT_TIMEOUT=300
cd /workspace/user_data/devinfo/track4-die
torchrun --nproc_per_node=2 --master_port=29501 hccl_allreduce.py
```
