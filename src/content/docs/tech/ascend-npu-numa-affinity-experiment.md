---
title: 昇腾 910 NPU 的 NUMA 亲和性实验：host↔NPU 传输的错位惩罚实测
description: 在 8-NUMA 节点的 Atlas 800T A3 上做 CPU/内存 NUMA 亲和性实验——逐节点 pin CPU + 首次触碰控内存（用 /proc/self/numa_maps 校验页落点），测 host↔NPU 的 H2D/D2H。结论：非 pinned 传输 NUMA 错位真实可观测（H2D 最坏 ~73%、D2H ~44% 惩罚），但 pinned 内存（pin_memory）把 NUMA 完全抹平且快 2.4x；还顺带发现部分 CPU 节点无本地内存、逻辑节点号不可信。
pubDate: 2026-08-11
---

这台 Atlas 800T A3 有 **640 核 / 8 个 NUMA 节点**。一个很自然的问题:**CPU 跑在哪个 NUMA 节点、内存分配在哪个节点,对喂 NPU 的数据传输有多大影响?** 这篇记下"怎么测"和"实测多少"。

运行环境:**Atlas 800T A3 · Ascend910_9382 die0 · 8 NUMA 节点 / 4 超节点(distance 10/15/20)· mdev 实例 · CANN 9.1.0-beta.1 · torch 2.12 + torch_npu 2.12**。

---

## 一、难点:容器把 NUMA 信息藏了一半

- **NPU 的 `numa_node` 在 sysfs 是 -1/未知**(mdev passthrough,不暴露),没法直接读"NPU 在哪个节点"。
- **`numactl` 没装**(不能 `--membind`);但 `libnuma.so` 在位。
- 好在:**8 个 NUMA 节点拓扑是暴露的**,`os.sched_setaffinity` 可 pin CPU,`/proc/self/numa_maps` 可逐页校验内存落点。

所以方案变成:**实测扫 8 个节点,让 NPU 本地节点自己"显形"**。

## 二、方法

每个 NUMA 节点起一个**独立子进程**(杜绝 caching allocator 跨进程复用):

1. `sched_setaffinity` pin 到该节点的前 8 个 CPU;
2. 经首次触碰分配 host 张量(pin CPU → 内存落该节点);
3. **读 `/proc/self/numa_maps` 校验页确实落在目标节点**(落点不对的标记 verify=fail);
4. 测 **H2D(host→NPU)** 与 **D2H(NPU→host)**,分 **非 pinned** 与 **pinned(pin_memory)** 两路,各 4MB/64MB/1GB 三档;warmup + 多轮取 p50。

> 容器坑:`numa_set_membind` 被拒(`set_mempolicy: Operation not permitted`),但 **CPU pin 的首次触碰照样把内存控到了目标节点**(numa_maps 实锤,7/8 节点落点正确)——内存亲和不需要 numactl。

## 三、结果:非 pinned 传输(NUMA 敏感)

@1GB,按"CPU 节点 → 内存实际落点"(GB/s):

| CPU 节点 | 内存落点 | H2D | D2H |
|---|---|---|---|
| **0** | 0 | **24.9** ★ | **25.4** ★ |
| 1 | 1 | **6.6** ✗ | 15.2 |
| 2 | 2 | 16.6 | 18.4 |
| 3 | 3 | 18.2 | 19.5 |
| 4 | 5 | 18.6 | 22.5 |
| 5 | 7 | 10.1 | 14.2 |
| **6** | 6 | **22.4** ★ | 23.4 |
| 7 | 7 | 18.6 | 25.0 |

**NUMA 错位真实可观测**:H2D 最优 node0(24.9)vs 最差 node1(6.6)= **~3.8x 跨度,~73% 惩罚**;D2H 25.4 vs 14.2 ≈ ~44%。node1 在 4MB/64MB/1GB 三档都一致垫底 → 是真实效应、不是噪声。**node0、node6 稳定最优 → 它们最靠近 NPU;node1 最差 → 离 NPU 最远。**

## 四、结果:pinned 传输(NUMA 被抹平,对照)

@1GB,**8 个节点全平**:H2D ~58–59、D2H ~41–42 GB/s。

→ **pinned 内存走 driver 的 staging 池 + DMA,把 NUMA 完全绕开了**;而且比最优的非 pinned(25 GB/s)还快 **~2.4x**。这是最有价值的可操作结论。

## 五、两个意外发现

1. **逻辑节点号不可信:CPU 节点 ≠ 内存节点**。pin 到 node4 的 CPU(320s),首次触碰把内存落到了 **mem5**;pin node5 的 CPU(400s)落到 **mem7**。说明**部分 CPU 节点没有本地内存、向伙伴节点借**。所以"NUMA 亲和"必须用 numa_maps 看真实落点,不能拿 CPU 节点号当内存节点号。
2. **CPU 亲和与内存落点都影响传输**。同一个 mem7,经 node5 的 CPU 发起 H2D=10.1、经 node7 的 CPU 发起=18.6——CPU 到 NPU 的路径也计入开销,不只是内存位置。

## 六、结论与处方

- ✅ **NUMA 错位惩罚可观测**:非 pinned H2D 最坏 ~73%、D2H ~44%。
- ✅ **处方明确**:**host↔NPU 传输一律用 `pin_memory`** → NUMA 无关 + 快 2.4x。在线推理的 input/output tensor 务必 pinned。
- ⚠️ **逻辑节点号不可信**(CPU↔内存错位),NUMA 实验必须用 `/proc/self/numa_maps` 校验真实落点。
- 💡 **node0/node6 最优** → 推测是 NPU 本地节点;**node1 最差** → 离 NPU 最远(拓扑/路由,mdev mediator 路径,需 msprof 进一步证实)。

> 教训:在容器/mdev 环境里做 NUMA 实验,sysfs 的 `numa_node` 和逻辑节点号都会骗你——**唯一可信的是 `/proc/self/numa_maps` 的实测页落点**。

---

## 复现

```bash
source /usr/local/Ascend/ascend-toolkit/set_env.sh; export ASCEND_RT_VISIBLE_DEVICES=0
# devinfo/numa/worker.py --node N   :单节点(pin CPU + 首次触碰 + numa_maps 校验 + H2D/D2H)
# devinfo/numa/driver.py            :扫 0..7 汇总 result.json + 超节点聚合
python driver.py
```
