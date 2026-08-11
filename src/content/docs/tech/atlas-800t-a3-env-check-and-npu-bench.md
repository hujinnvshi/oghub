---
title: Atlas 800T A3 推理设备核查与 NPU 基准实测
description: 拿到一台被称作"顶级推理设备"的机器，动手核实——产品型号其实是 Atlas 800T A3（训练版，非 800I）、芯片板卡 9382（当前实例 2 颗 ×64GB HBM）、软件栈 CANN 9.1.0-beta.1 + venv-trackb（torch 2.12 / torch_npu 2.12 / transformers 5.15），并跑通 NPU 基准：单芯 ~300 TFLOPS、HBM ~1.27 TB/s、12 层小 Transformer 前向 ~151k tok/s。
pubDate: 2026-08-11
---

拿到一台新机器，交接时被告知"是 Atlas 800I A3，属于顶级推理设备了"。第一反应是：先别信标签，自己探一遍。于是把硬件型号、芯片规格、软件栈位置逐一核实，顺手写了个自包含的 NPU 基准脚本把算力实测出来。这篇就是这次核查的记录。

运行环境：**Atlas 800T A3（实测，见下文纠正）· Ascend910 / 板卡 9382 · 当前实例 2 颗芯片 ×64 GB HBM · CANN 9.1.0-beta.1 · aarch64（鲲鹏 640 核 / 2 TiB 内存）**。

---

## 一、先纠正一个型号误解：是 800T，不是 800I

交接说的是 **800I（I = Inference，推理版）**。但 `cat /sys/class/dmi/id/product_name` 给的实际是：

```
Atlas 800T A3
```

即 **800T（T = Training，训练版）**。两者同属 Atlas 800 A3 代、都基于 Ascend 910 级芯片（64 GB HBM），训练推理通吃——所以"顶级推理设备"的判断在实质上成立，但严谨的产品口径得改成 **800T A3**。后续对外写配置、报型号，按 800T A3 来。

> 教训：交接标签不等于实际型号。DMI（`/sys/class/dmi/id/product_name`）才是机箱层面的权威来源，比 `npu-smi` 显示的通用品类名（它只回显 `Ascend910`，不区分 A2/A3、800I/800T）更准确。

---

## 二、硬件实测：旗舰硅片，但是切分实例

| 项目 | 实测值 | 来源 |
|---|---|---|
| 产品型号 | **Atlas 800T A3** | `/sys/class/dmi/id/product_name` |
| 主板 | BC83AMDBI-7285Z | DMI |
| 板卡型号 | **9382** | `npu-smi info -t board` |
| 芯片字符串 | `Ascend910_9382` | `torch.npu.get_device_properties` |
| npu-smi 显示 | `Ascend910` / `Chip Version: V1` | `npu-smi info` |
| 可见 NPU / 芯片 | **1 块板 / 2 颗芯片** | `npu-smi info -l` |
| `torch.npu.device_count()` | **2** | torch_npu |
| 单芯片 HBM | **64 GB**（npu-smi 65536 MB；torch 可见 ~62.7 GB） | npu-smi / torch |
| 单芯片算力核 | 24 cube + 48 vector，L2 = 192 MB | torch_npu properties |
| 固件 Firmware | 7.8.0.5.216 | `npu-smi info -t board` |
| npu-smi 版本 | 25.5.1 | `npu-smi info` |

**两个要点：**

1. **当前是整机切分出来的实例，不是整机。** Atlas 800 整机通常有 8 颗 NPU，但这里 `npu-smi info -l` 只看到 1 块板 / 2 颗芯片。本机还跑着 `supervisord` + `clabagent`（cloud-lab 管理代理），典型特征是受管的容器/云实验室实例——只暴露整机的一部分。做规划和算力估算时，**别按整机 8 卡算，按 2 颗芯片算**。

2. **HBM 口径要分清。** npu-smi 报 65536 MB（物理 64 GB），但 torch_npu 的 `total_memory` 是 ~62.7 GB，差额是系统/固件占用。容量评估用 ~62 GB 这个可用值更稳。

CPU / 内存 / OS 顺带记下：鲲鹏 aarch64 **640 核**、**2 TiB 内存**、Ubuntu 22.04.5、300 GB overlay 盘（297 GB 空闲）。内存和核数都极其充裕。

---

## 三、软件栈：系统 Python 是空的，真正的栈在 venv-trackb

这是这次核查里最值得记的一坑。一上来 `pip list` 看系统 Python（3.12.13），发现 **torch / mindspore / mindie / vllm 一个都没有**，差点以为这台机器是个空壳。

但 `ps` 里赫然有个进程在跑：

```
/workspace/user_data/venv-trackb/bin/python ... import torch, torchvision, torch_npu ...
```

——真正的推理栈装在独立虚拟环境 **`venv-trackb`** 里，不在系统 Python。

### 系统级（已装）

| 组件 | 版本 / 路径 |
|---|---|
| CANN toolkit | **9.1.0-beta.1**（V100R001C11B050），`/usr/local/Ascend/cann-9.1.0-beta.1` |
| ATB（Ascend Transformer Boost） | 已装，`/usr/local/Ascend/nnal/atb/latest/atb/cxx_abi_1` |
| `atc` / `msprof` / driver | ✅ 均在 |
| `acl`（Python） | ✅ 系统 Python 可 import |

### `venv-trackb`（主推理栈）

| 包 | 版本 |
|---|---|
| torch | **2.12.0**（+cu130 构建） |
| torch_npu | **2.12.0** |
| torchvision | 0.27.0 |
| transformers | **5.15.0** |
| accelerate | 1.14.0 |
| tokenizers / safetensors / pillow | 0.22.2 / 0.8.0 / 12.3.0 |
| numpy | 2.5.2 |

另有 `venv-omni`（未深查，疑似多模态 / Qwen-Omni 相关）。`mindspore`、`mindie`、`vllm`、`msnpureport` 系统级均未装——vLLM-ascend / MindIE 如需使用，建议装到独立 venv，别污染 venv-trackb。

> 教训：判断"装没装"不能只看系统 Python，昇腾环境里推理栈经常隔离在业务 venv 里。**`ps aux | grep python` 看谁在用 NPU**，比 `pip list` 更快定位真正的栈在哪。

---

## 四、NPU 基准实测：两颗芯片对称且健康

写了个自包含脚本（不下载模型权重，纯 torch_npu），测三件事：HBM 带宽（大张量 `copy_`）、矩阵乘 TFLOPS（fp16 / bf16，8192²）、以及一个随机初始化的 12 层小 Transformer 前向（走真实 attention/MLP kernel）。每项 warmup 后取多轮均值。

| 指标 | device 0 | device 1 |
|---|---|---|
| HBM 带宽（copy_, fp16） | **1267 GB/s** | **1270 GB/s** |
| matmul fp16（8192²） | **294.5 TFLOPS** | **299.2 TFLOPS** |
| matmul bf16（8192²） | **294.6 TFLOPS** | **299.3 TFLOPS** |
| Transformer 前向（12 层 / hidden 1024, bf16） | **~151k tok/s** | **~151k tok/s** |

> Transformer 前向：13.6 ms/step、2048 tok/step、~267M 参数（随机初始化，仅用于跑通真实 kernel，不代表任何真实模型吞吐）。

**解读：**

- 两颗芯片结果**对称**（TFLOPS 差 ~1.5%、带宽差 <0.3%），健康。
- 单芯 **~300 TFLOPS（fp16/bf16）** 与 **~1.27 TB/s HBM**，符合 Ascend 910（9382）旗舰级预期——和之前 [910B 上的 Roofline 经验值（FP16 ~320 TFLOPS / HBM ~1.2 TB/s）](./minicpm-omni-910b-perf-test-recap) 对得上。
- 推理栈（torch 2.12 + torch_npu 2.12 + transformers 5.15）在 NPU 上**端到端跑通**，真实 attention/MLP kernel 可用。

核心测量逻辑（完整脚本随附仓库）：

```python
import torch, torch_npu  # torch_npu 注册 npu 后端
dev = 0; torch.npu.set_device(dev)
a = torch.randn(8192, 8192, dtype=torch.float16, device=f"npu:{dev}")
b = torch.randn_like(a)
for _ in range(5): _ = a @ b          # warmup
torch.npu.synchronize(dev); t0 = time.perf_counter()
for _ in range(20): c = a @ b
torch.npu.synchronize(dev)             # 关键：必须 synchronize 才能准确计时
tflops = 2 * 8192**3 / ((time.perf_counter()-t0)/20) / 1e12
```

> 昇腾计时要点：每段测量前后都 `torch.npu.synchronize(dev)`，先 warmup（首次调用有 kernel 编译开销，首次 import torch_npu 也要 1～2 分钟，别误判成卡死）。

---

## 五、问题汇总

| # | 现象 | 根因 | 处置 |
|---|---|---|---|
| 1 | 交接称 800I A3 | DMI 实报 800T A3 | 改口径为 800T A3，实质不影响推理可用 |
| 2 | 以为整机 8 卡 | cloud-lab 切分实例，只暴露 2 颗芯片 | 按 2 芯片规划算力 |
| 3 | 系统 Python 查不到 torch | 推理栈隔离在 venv-trackb | 跑 NPU 代码统一用 `/workspace/user_data/venv-trackb/bin/python` |
| 4 | HBM 容量两个数对不上 | npu-smi 报物理 64 GB，torch 报可用 ~62.7 GB | 容量评估用 ~62 GB |
| 5 | 首次 import / 首次 kernel 慢 | torch_npu 初始化 + 算子编译 | warmup 后再计时，别在冷启动段取数 |

---

## 六、结论

- ✅ **硅片旗舰级**：Ascend 910（9382），64 GB HBM × 2，训练推理通吃。
- ✅ **推理栈可用**：venv-trackb 里 torch 2.12 + torch_npu 2.12 + transformers 5.15，NPU 端到端跑通，单芯 ~300 TFLOPS / ~1.27 TB/s。
- ⚠️ **三处口径要记牢**：型号是 **800T A3**（非 800I）；当前是 **2 芯片切分实例**（非整机 8 卡）；跑 NPU 代码用 **`venv-trackb`**（系统 Python 是空的）。

一句话：这台"顶级推理设备"名副其实，但要在它上面干活，先把这三个口径对齐，免得按错误前提规划。

---

> 附：本机的完整环境核查报告（`ENVIRONMENT.md` / `environment.json`）、基准脚本（`bench_npu.py`）与原始结果存放在工作区 `/workspace/user_data/devinfo/`。前一天还做过一轮多阶段昇腾核查在 `verify-ascend-2026-08-10/`（含 VideoMME 视频评测数据），后续可接续做多模态评测。
