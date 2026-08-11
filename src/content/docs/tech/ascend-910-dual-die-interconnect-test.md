---
title: Atlas 800T A3 双 die 互联带宽测试：方法与 SIO 实测
description: 记录在 Ascend 910（9382）双 die 上测 die-to-die 互联带宽的三种方法（p2p 拷贝 / HCCL 集合通信 / npu-smi 佐证），并用 torch_npu 的 a.to(npu:1) 实测——结果是峰值 ~187 GB/s、双向对称，推翻了“SIO=慢速总线”的先入之见。
pubDate: 2026-08-11
---

拿到这台 Atlas 800T A3（2 颗 Ascend910_9382 die），第一件事想搞清楚：**两颗 die 之间的互联到底有多快？** 这决定了能不能玩 Tensor Parallel、跨卡通信会不会成瓶颈。这篇记下"怎么测"和"实测多少"。

运行环境：**Atlas 800T A3 · Ascend910_9382 · 2 颗 die × 64 GB HBM · CANN 9.1.0-beta.1 · torch 2.12 + torch_npu 2.12 · venv-trackb**。

---

## 一、先认清拓扑：两 die 是 SIO，不是 HCCS

`npu-smi info -t topo` 实测：

```
          Phy-ID2    Phy-ID3
Phy-ID2     X          SIO        ← 两 die 之间是 SIO
Phy-ID3   SIO           X
```

华为的高速缓存一致性互联叫 **HCCS**（类 NVLink）。这台两 die 之间报的是 **SIO**，按经验直觉会以为"比 HCCS 慢一档、可能只有几 GB/s"——**这个直觉后面被实测推翻了**。

> 坑：`npu-smi -t hccs-bw` 是 HCCS 专用计数器，跨 SIO die 测出来 ≈ 0，只能"反证不是 HCCS"，**不能用来测 SIO 带宽**。

---

## 二、三种测法（从简到全）

| 方法 | 测什么 | 成本 | 工具 |
|---|---|---|---|
| **A. p2p 拷贝**（最直接） | die→die 单向拷贝带宽，单进程 | ~1 分钟 | torch_npu `a.to('npu:1')` 计时 |
| **B. HCCL 集合通信** | AllReduce/AllGather 带宽（贴近真实多卡负载） | ~2 分钟 | `torchrun` + `torch.distributed(backend='hccl')` |
| **C. npu-smi 佐证** | 拓扑/链路状态（定性） | 秒级 | `-t topo` / `-t hccs` |

**通用注意**：
- 必须 `source /usr/local/Ascend/ascend-toolkit/set_env.sh` + `export ASCEND_RT_VISIBLE_DEVICES=0,1`。
- 计时务必 `torch.npu.synchronize()` + **warmup 5 轮** + **多轮取中位**（首拷含 HBM 分配开销，不能要）。
- **`torch_npu.hccl` 这个属性不存在**（会 KeyError）；HCCL 走 `torch.distributed.init_process_group(backend='hccl')`，import torch_npu 时自动注册后端。

下面用方法 A 把这台机器的真实数字测出来。

---

## 三、方法 A 实测：p2p 拷贝带宽

脚本核心：在 `npu:0` 上 allocate 大张量，`.to('npu:1')` 拷到 `npu:1`，前后 `synchronize`、多轮取中位；带宽 = `nbytes / dt`（单向链路）。多档消息 + 双向，再加一个同卡 clone 作 HBM 本地上限对照。

```python
import time, statistics, torch, torch_npu  # noqa
def copy_bw(src, dst, nbytes, WARM=5, ITERS=20):
    a = torch.randn(nbytes // 2, dtype=torch.float16, device=src)
    for _ in range(WARM): b = a.to(dst)
    torch.npu.synchronize()
    ts = []
    for _ in range(ITERS):
        t0 = time.perf_counter(); b = a.to(dst); torch.npu.synchronize()
        ts.append(time.perf_counter() - t0)
    dt = statistics.median(ts)
    return nbytes / dt / 1e9, dt * 1000
```

**结果（fp16，每档 20 轮取中位）**：

| 消息大小 | 0→1 (GB/s) | 1→0 (GB/s) | 单次延迟 (ms) |
|---|---|---|---|
| 1 MB | 4.7 | 4.4 | 0.221 |
| 4 MB | 19.2 | 17.2 | 0.219 |
| 16 MB | 59.2 | 62.5 | 0.283 |
| 64 MB | 116.5 | 116.3 | 0.576 |
| 256 MB | 155.1 | 156.6 | 1.731 |
| 1024 MB | 182.4 | 183.6 | 5.887 |
| **2048 MB** | **186.7** | **187.5** | 11.503 |

> 对照：dev0 本地 `clone` 1 GB = **621 GB/s**（HBM 本地带宽上限）。

---

## 四、解读：SIO 不慢，先入之见要纠正

- **峰值 ~187 GB/s，双向完全对称** —— 这已经是 **HCCS 级别**的带宽，不是想象中的"慢速总线"。所以别被 `topo` 里的 "SIO" 字样吓到，这台机器的跨 die 链路很快。
- **带宽随消息增大爬升**：< 64 MB 时延迟主导（单次 ~0.22 ms）根本吃不满；要 ≥ 1 GB 才逼近峰值。**结论：小张量跨 die 划不来，大块才接近 187 GB/s。**
- **相对本地 HBM（621 GB/s），跨 die 约 30%** —— 有代价但不致命。

一句话：**"topo 报 SIO" ≠ "带宽低"**。型号/标签不等于实测，互联速度必须自己测一遍。

---

## 五、对多卡推理的含义

187 GB/s 够用，**跨 die 不是硬瓶颈**：

- **Tensor Parallel 可行**——AllReduce 大张量（如 KV、激活分片）能吃接近峰值带宽。
- 但小激活频繁跨 die 会吃亏（延迟区 < 64 MB 只有几十 GB/s）——**通信要攒大块**。
- 数据布局优先级：**按层切片 / Pipeline Parallel > 朴素复制**，尽量减少跨 die 流量。
- p2p 拷贝是裸链路带宽；真实 AllReduce/AllGather 有算法开销，想看负载侧数字用方法 B（HCCL）。

---

## 六、复现

```bash
source /usr/local/Ascend/ascend-toolkit/set_env.sh
export ASCEND_RT_VISIBLE_DEVICES=0,1
# 脚本: track4-die/p2p_interconnect.py(多档消息+双向+本地对照)
python p2p_interconnect.py
```

---

## 结论

- ✅ **两 die 互联峰值 ~187 GB/s，双向对称**，HCCS 级别，足够支撑多 die 并行。
- ⚠️ **小消息延迟受限**（< 64 MB 吃不满），通信要攒批。
- 💡 **教训**：`npu-smi -t topo` 报 "SIO" 不代表慢——互联带宽必须实测，标签会骗人。

> 附：方法 B（HCCL 集合通信带宽，AllReduce 64/256/1024 MB）脚本已就绪，跑出来补到这里即可得到"真实负载侧"的通信带宽。
