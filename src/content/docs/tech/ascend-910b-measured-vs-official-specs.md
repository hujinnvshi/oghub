---
title: 昇腾 910B 实测算力/HBM/互联 vs 官方标称：口径与匹配度
description: 把 Atlas 800T A3（Ascend910_9382）上实测的 FP16（~293 TFLOPS）、HBM（~1.27 TB/s）、die 间互联（SIO ~187 GB/s）与官方/第三方标称逐项对比——算力与 HBM 匹配良好且接近峰值；但"187 GB/s"是 SIO 链路、不是 HCCS 的 392 GB/s，不能直接对标；另指出华为未公开 910B 官方 datasheet、peak 与 achieved 的口径差异。
pubDate: 2026-08-11
---

前面在这台 Atlas 800T A3 上实测了算力、HBM 带宽和双 die 互联（见[核查与基准](./atlas-800t-a3-env-check-and-npu-bench)、[双 die 互联测试](./ascend-910-dual-die-interconnect-test)）。一个自然的问题:**这些数和官方标称对得上吗?** 这篇把实测和官方/第三方标称逐项摆出来比,并把几个容易误读的"口径坑"讲清楚。

运行环境:**Atlas 800T A3 · Ascend910_9382(2 颗 die × 64 GB HBM)· CANN 9.1.0-beta.1 · torch 2.12 + torch_npu 2.12**。

---

## 一、先定位代际:这是 910B 级,不是初代 910

`npu-smi` 只显示通用品类名 `Ascend910 V1`、板卡 `9382`,代际本身模糊。最强判据是 **HBM 带宽**:

- 初代 Ascend 910 官方 HBM = **400 GB/s**(华为 Atlas 800 文档);
- 我们实测 HBM = **1.27 TB/s ≈ 1270 GB/s**——是初代的 3 倍,**绝不可能是初代 910**。

结合 64 GB HBM + ~293 TFLOPS FP16,本机硅片是 **910B 级**。这也和之前 "910B 双 die" 的记录一致(npu-smi 的 `Ascend910 V1` 只是通用品类名,别被它误导)。

---

## 二、官方标称 vs 实测

| 指标 | 官方/权威标称(910B) | 我们实测(achieved) | 匹配度 |
|---|---|---|---|
| **FP16 算力** | ~320 TFLOPS peak(第三方共识) | **293 TFLOPS**(matmul 大方阵) | **~91%** ✅ |
| **HBM 带宽** | ~1.2 TB/s(Mirrorfrog 1224 GB/s) | **1.27 TB/s**(copy_ 流式) | **~100%** ✅ |
| **INT8** | ~640 TOPS | 原生报错;动态量化 49 TFLOPS | ⚠️ 未测到峰值 |
| **片间互联** | HCCS ~392 GB/s(部分来源) | **187 GB/s**(SIO) | ❌ 口径不同,不可直比 |

---

## 三、逐项判断

### ① FP16 ~91% — 匹配

293 TFLOPS achieved 对 ~320 TFLOPS peak,GEMM 效率 91%。偏高,但在 8192² 方阵 + 优化 `aclnnMatmul` 下可信。若真实 peak 更高(部分来源 ~340–376 TFLOPS),则是 78–86%,更典型。**结论:算力在 910B 该有的区间,且接近峰值。**

### ② HBM ~100% — 匹配,已打满

`copy_` 是纯流式读写,1.27 TB/s 基本顶到 910B 的 ~1.2 TB/s HBM 上限(略高在测量口径/第三方标称误差内)。**HBM 不是瓶颈。**

### ③ 互联 187 GB/s — 不能直接对标"392 GB/s"

这是最容易误读的一项,必须分清:

- 官方/第三方的 **~392 GB/s 是 HCCS**(华为类 NVLink 的高速互联)带宽;
- 但本机两颗 die 在 `npu-smi info -t topo` 里报的是 **SIO**,`-t hccs-bw` 跨 die ≈0——**这两 die 根本不走 HCCS**;
- 所以 187 GB/s 是 **SIO 链路**实测,不是 HCCS 数字。**两者是不同 fabric,放一起比是错的。**

合理推测:这是 cloud-lab 切分实例的两 die(可能跨 package 经 SIO 互联);整机 HCCS 直连场景才有 ~392 GB/s。

### ④ INT8 未对标

torch 原生 `int8@int8` 在 NPU 直接报错(`MatmulKernelNpuOpApi`),int8 推理须走 **ATB/MindIE 的 W8A8 专用算子**。本次只测了动态量化(W8A16)49 TFLOPS——**这不是 910B 的 INT8 峰值(~640 TOPS)**。要标定 INT8 得用 W8A8 算子,留作后续。

---

## 四、三个口径坑(比对了才看得清)

1. **华为未公开 910B 官方 datasheet。** 上表的 320 TFLOPS / 1.2 TB/s / 392 GB/s 都是**第三方整理的共识值**,非华为一手公布,本身有 ±10–20% 不确定性。初代 910 的 90 GB/s HCCS / 400 GB/s HBM 才是华为官方文档明确给出的。
2. **peak ≠ achieved。** 官方是理论峰值,我们是持续算子吞吐,正常就该差一截(算力 70–95%、流式拷贝接近 100%)。"实测略低于 peak"是健康的;反过来 HBM 实测≈标称说明已打满。
3. **互联口径最易踩。** 别拿 187(SIO)去比 392(HCCS)——先看 `topo` 确认两 die 是哪种 fabric,再选对标值。

---

## 五、结论

- ✅ **算力、HBM 与 910B 标称匹配**(FP16 ~91% peak、HBM 打满),硅片性能正常发挥。
- ⚠️ **互联 187 GB/s 是 SIO 实测,非 HCCS 标称**,两者不可直接比较——本切分实例 die 间是 SIO 拓扑。
- ⚠️ **INT8 未测到峰值**(需 W8A8 专用算子,后续补)。
- 💡 **教训**:`npu-smi` 的通用品类名 + 第三方标称都不靠谱,**代际和性能都要用实测数据反推**(这里靠 HBM 带宽一下就区分了初代 910 和 910B)。

---

## 参考(标称来源)

- [华为 Atlas 800 训练服务器用户指南——技术规格(初代 910:3×HCCS 90GB/s,HBM 400GB/s)](https://support.huawei.com/enterprise/en/doc/EDDOC1100141955/3cf58244/technical-specifications)
- [Mirrorfrog——Ascend 910B(320 TFLOPS FP16,HBM 1224 GB/s)](https://mirrorfrog.com/en/docs/cards/huawei/ascend-910b)
- [知乎——NPU(910B/C) vs GPU(H100) 参数速查](https://zhuanlan.zhihu.com/p/2004196636507789012)
- [Emergent Mind——Ascend 910C(参考,~800 TFLOPS / ~3.2 TB/s)](https://www.emergentmind.com/topics/huawei-ascend-910c-npus)
- [Georgetown CSET——Pushing the Limits(910B 较初代算力提升)](https://cset.georgetown.edu/publication/pushing-the-limits-huaweis-ai-chip-tests-u-s-export-controls/)
