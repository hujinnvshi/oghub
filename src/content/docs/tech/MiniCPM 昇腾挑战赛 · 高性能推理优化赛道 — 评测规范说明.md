# MiniCPM 昇腾挑战赛 · 高性能推理优化赛道 — 评测规范说明

本文档为赛道一（高性能推理优化赛道）的官方评测规范说明，包含各子赛道的精度与性能 Baseline 数据、Benchmark 评测方式及准入条件，供参赛团队参考。

---

# 一、赛道与子赛道概览

本赛道围绕 **MiniCPM\-o 4\.5** 全模态模型，在 **昇腾 NPU 单卡 910C** 上进行推理适配与性能优化。赛道下设两个独立子赛道，分别采用不同的推理框架，独立评测与排名。

||子赛道 A|子赛道 B|
|---|---|---|
|**推理框架**|llama\.cpp\-omni|vLLM\-Omni|
|**运行环境**|CANN 9\.1\.0\-beta1|vllm\-omni:v0\.25\.0\-a3|
|**核心性能指标**|RTF|RTF、TTFT、TTFP|
|**框架仓库**|[llama\.cpp\-omni](https://github.com/tc-mb/llama.cpp-omni)|[vLLM\-Omni](https://github.com/vllm-project/vllm-omni)|

---

# 二、官方 Benchmark 与评测方式

本赛道使用以下三项 Benchmark 对优化版本的模型精度和能力进行统一验证。各 Benchmark 的评测方式与原版一致，基于官方指定的数据版本、测试子集和评测脚本执行。

|Benchmark|评测能力|说明|
|---|---|---|
|**VideoMME**|视频多模态理解|评估模型在视频理解任务上的准确率|
|**Daily\-Omni**|全模态日常交互|评估模型在日常对话与交互场景中的综合表现|
|**TTS\-Seed**|语音合成质量|包含 ASV（说话人相似度，↑ 越高越好）和 WER（语音识别错误率，↓ 越低越好）|

两个子赛道均以对应框架下的官方基线结果作为对比基准。

---

# 三、精度 Baseline（两子赛道共用）

参赛方案必须同时满足以下两项条件，方可进入性能评测与排名。

## 4\.1 精度达标

优化版本相对于该子赛道官方基线的精度降幅**不得超过 2 个百分点**。以昇腾 910C 复现（F16）为基线，精度准入参考如下：

|Benchmark|基线值|准入阈值|规则|
|---|---|---|---|
|VideoMME|69\.0|≥ 67\.0|降幅 ≤ 2pp|
|Daily\-Omni|79\.5|≥ 77\.5|降幅 ≤ 2pp|
|TTS\-Seed ASV|0\.709|≥ 0\.689|降幅 ≤ 0\.02|
|TTS\-Seed WER|1\.414|≤ 1\.56|增幅 ≤ 10%|

VideoMME 和 Daily\-Omni 按绝对降幅 ≤ 2 个百分点判定；
TTS\-Seed ASV 按绝对降幅 ≤ 0\.02 判定；TTS\-Seed WER 按相对增幅 ≤ 10% 判定

以下情况将被判定为不达标：

- 精度降幅超过规定范围

- 模型核心能力出现明显下降

- 输出结果异常或无法完成指定 Benchmark

- 修改模型行为，导致评测结果失去可比性

## 4\.2 Demo 可用

优化版本必须能够正常接入该子赛道指定的官方 Demo，并完成稳定的端到端运行。评审将检查：

- 模型服务正常启动，Demo 正常连接推理服务

- 音频、视频和文本输入能够正常处理，模型输出完整

- 流式语音输出连续，无明显卡顿、中断或异常退出

- 能够完成官方指定的完整交互流程，连续运行保持稳定

仅能运行 Benchmark 但无法正常接入 Demo 的方案，不满足准入条件。

---

# 四、准入条件

以下为 MiniCPM\-o 4\.5 在不同版本下的官方精度对比数据，两个子赛道共用同一组基线作为精度准入参考。

|权重精度|VideoMME|Daily\-Omni|TTS\-Seed ASV ↑|TTS\-Seed WER ↓|
|---|---|---|---|---|
|**F16**|**69\.0**|**79\.5**|**0\.709**|**1\.414**|
|Q8\_0|68\.9|79\.6|0\.708|1\.387|
|Q4\_0|67\.6|79\.9|0\.707|1\.387|

---

# 五、子赛道 A 性能 Baseline — llama\.cpp\-omni

## 全双工推理阶段说明

MiniCPM\-o 4\.5 全双工推理可分为三种状态：

- **LISTEN**：运行 VPM、APM 和 LLM，不运行 TTS / T2W。

- **SPEAK 生成**：运行 VPM、APM、LLM、TTS 和 T2W。负载最高，是实时流式生成的主要瓶颈。

- **SPEAK 尾部**：LLM 已结束，仅 TTS / T2W 继续生成剩余语音。

**优化目标**：本次比赛主要优化目标为 SPEAK 生成阶段（SPEAK→WAV 完整链路）的 RTF，而非全部 chunk 的平均 RTF。该阶段负载最高，是实时流式语音生成在端侧运行的主要瓶颈。

**注意**：不同测试用例因 LISTEN 和 SPEAK 阶段比例不同，全部 chunk 的平均 RTF 数值差异较大。如果误用全部 chunk 的平均 RTF 进行对比会造成误导，选手测试时需格外注意，应以 SPEAK 生成阶段的 RTF 作为优化和对比依据。

$\text{RTF} = \frac{\text{音频 chunk 生成耗时}}{\text{音频 chunk 时长}}$

RTF 越低，表示模型生成音频的速度越快，实时性能越好。最终排名以 **SPEAK 生成阶段的 RTF** 为核心依据，在统一环境下评测。

## 性能 Baseline（昇腾 910C，单并发）

|指标|说明|F16 官方基线值|
|---|---|---|
|**全部 chunk 平均 RTF**|所有阶段 chunk 的平均实时因子（仅供参考）|0\.618|
|**SPEAK→WAV 完整链路 RTF**|SPEAK 生成阶段的 RTF（**主要优化目标**）|**1\.087**（平均 1087\.3 ms）|

---

# 六、子赛道 B 性能 Baseline — vLLM\-Omni

## 核心评测指标

子赛道 B 采用三个维度综合评测：

|指标|定义|优化方向|
|---|---|---|
|**RTF**|音频 chunk 生成耗时 ÷ 音频 chunk 时长|↓ 越低越好|
|**TTFT**|从接收请求到模型输出首个有效 token 的时间|↓ 越低越好|
|**TTFP**|从接收请求到输出第一段可用音频的时间|↓ 越低越好|

最终成绩将综合考虑 RTF、TTFT 与 TTFP，具体归一化方法、统计口径和权重以官方最终评测文档为准。

## 性能 Baseline（昇腾 910C，单并发）

|指标|说明|官方基线值|
|---|---|---|
|**TTFT**|Time to First Token，首个有效 token 的响应时间|**333\.27 ms**|
|**TTFP**|Time to First Packet，首段可用音频的响应时间|**986\.47 ms**|
|**RTF**|Real\-Time Factor，每个音频 chunk 的实时因子|**0\.4423**|

---

# 七、统一评测流程

|步骤|内容|
|---|---|
|**1\. 框架与环境检查**|确认参赛方案使用对应子赛道指定的推理框架，并能在官方昇腾环境中完成部署和运行|
|**2\. Benchmark 精度评测**|通过 VideoMME、Daily\-Omni、TTS\-Seed 对优化版本进行模型能力和精度验证|
|**3\. Demo 可用性验证**|将优化版本接入对应子赛道官方 Demo，完成端到端功能与稳定性测试|
|**4\. 性能评测**|正式测试前进行多轮预热，在统一配置下执行多轮测试，记录各项性能指标|
|**5\. 工程复现审查**|主办方根据提交的代码、配置与文档在官方环境中重新部署并测试，验证可复现性|

---

# 八、最终提交内容

|类别|具体内容|
|---|---|
|**完整代码与配置**|推理适配与性能优化代码、框架配置、服务启动脚本、Benchmark 执行脚本、Demo 启动脚本、依赖与环境配置文件|
|**Benchmark 评测结果**|VideoMME、Daily\-Omni、TTS\-Seed 三项 Benchmark 的完整结果（含测试命令、参数配置、原始输出和结果汇总）|
|**性能测试报告**|RTF（及 TTFT / TTFP，vLLM\-Omni 子赛道）、测试环境、测试数据、统计方式、优化前后对比|
|**可运行 Demo**|演示视频、Demo 使用说明、启动与访问方式|
|**优化与复现说明**|原始性能瓶颈分析、优化方法、各项优化带来的性能变化、完整复现步骤|

---

# 九、参考链接

|资源|链接|
|---|---|
|推理框架 — 子赛道 A|[llama\.cpp\-omni](https://github.com/tc-mb/llama.cpp-omni)|
|推理框架 — 子赛道 B|[vLLM\-Omni](https://github.com/vllm-project/vllm-omni)|
|模型|[MiniCPM\-o 4\.5（ModelScope）](https://www.modelscope.cn/models/OpenBMB/MiniCPM-o-4_5)|
|Demo — 子赛道 A|[MiniCPM\-o\-Demo](https://github.com/OpenBMB/MiniCPM-o-Demo)|
|Demo — 子赛道 B|[在昇腾 NPU 上使用 vllm\-omni部署 MiniCPM\-o 4\.5](https://qcn9xlavkz5b.feishu.cn/wiki/UzxWwSnofifkxCkFNcAcTIaNnFe)|
|算力申请指南|[HiDevLab 申请流程](https://modelbest.feishu.cn/wiki/PeStwWCA1i0ptXkqh9scu5AynUe)|

---

*如对赛题有任何疑问，请通过官方渠道与组委会联系。*

