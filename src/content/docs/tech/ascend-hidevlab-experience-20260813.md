---
title: 昇腾 910C + vLLM-Omni 比赛环境实操经验（踩坑与解法）
description: HiDevLab 昇腾环境多日实测沉淀，面向 vLLM-Omni 子赛道参赛队伍，按主题分类可直接复用；所有建议均来自真实跑通/踩坑记录。
pubDate: 2026-08-13
---

# 昇腾 910C + vLLM-Omni 比赛环境实操经验（踩坑与解法）

> 面向：vLLM-Omni 子赛道参赛队伍，HiDevLab 昇腾环境。
> 内容为团队多日实测沉淀，按主题分类可直接复用。所有建议均来自真实跑通/踩坑记录。

---

## 0. 十句话速查

1. 跳板令牌有效期很短：**新连接**需不断刷新令牌，但**已建立的连接可以活很久**——长任务务必脱离连接跑（nohup），不要裸跑。
2. 网页网关的 `/proxy/<端口>/` 对 **WebSocket / SSE 支持不好**：Gradio 这类应用会报「服务端返回了非 JSON 的纯文本，开头 Unsupported…」。解法：SSH 本地端口转发，浏览器访问 `127.0.0.1`。
3. 新镜像的竞赛 Python 在 `/usr/local/python3.12.13/bin`，记得 `export PATH`；系统 python3 是 3.10 且没有 pip。
4. `vllm bench` 客户端：`--model` 必须用**本地路径**（HF 名会 OSError）；请求的 model id 必须和 serve 暴露的 id 一致，否则 404。
5. WER 打分在离线环境必须 `HF_HUB_OFFLINE=1`，否则会卡死或报错；transformers 5.x 下 whisper-large-v3 缓存常缺 `processor_config.json`，手动补一个即可。
6. `corrupted size vs. prev_size` 崩溃发生在进程收尾阶段，**结果 JSON 已落盘就没影响**，不用重跑；但要确保 `--save-result --result-dir` 开好。
7. 容器的 PID 1 是 `tail -f /dev/null`，**不回收僵尸进程**：脚本里判断「进程结束」要用 `/proc/<pid>/stat` 的状态 `Z`，别用 `kill -0`。
8. 性能优化 knob 要放在正确的位置：`connectors.connector_of_shared_memory.extra` 下，放 stage 顶层会静默忽略；改完 `grep` 确认再跑。
9. 每轮优化必须做**同口径 A/B**：同一台机器、同一命令、只改一个变量；并核对配置真的生效（看文件 mtime 与运行时刻，防"改了没生效还当有效"）。
10. 长任务写成**自治脚本**（起 serve → 等健康 → 跑测试 → 落盘 → 写完成标志），一条命令点着，断连不丢，回来只查标志文件。

---

## 1. 连接与环境

### 1.1 跳板令牌：新连接短命，已建连接长寿

平台跳板使用短期令牌认证，实测规律：

- 令牌对**新连接**的有效期约 10 分钟，到期后打开新通道会被拒（`platform authorization denied` / `Administratively prohibited`）。
- **已建立的连接**不会立刻被杀，实测可存活几十分钟到更久。
- 因此：长任务一律 `nohup ... &`（或 `setsid`）脱离 SSH 连接；断线只影响你查看，不影响任务。恢复时贴新令牌重连即可，任务还在跑。
- 容器里没有 tmux，`nohup` 是最简可用方案；脚本内记得 `</dev/null >log 2>&1`，否则后台进程会占住 SSH 通道导致命令「卡住不返回」。

### 1.2 网页网关对 WebSocket/SSE 不友好

通过平台 `/proxy/<端口>/` 访问网页应用时：

- 普通 GET 页面正常；
- 但 Gradio / 需要 WebSocket 或 SSE 的应用会失败，典型报错：
  - `Unsupported ...`（纯文本，非 JSON）
  - `Could not parse server response: SyntaxError ...`
- 现象是「页面能开，点按钮报错」，且**后端日志里一条请求都没有**——请求根本没到服务。
- 解法：SSH 本地端口转发，浏览器访问 `http://127.0.0.1:<端口>`：
  ```bash
  ssh -N -L 127.0.0.1:7862:127.0.0.1:7862 -J <用户>@<跳板>:<端口> root@<目标机>
  ```
- 注意：本地 HTTP 下浏览器不给麦克风权限，用「上传音频/视频文件」完成多模态交互即可；真需要实时语音再接 HTTPS。

### 1.3 WebIDE 下载大文件会被网关拦

文件树下载稍大的文件（几 MB 以上）会报「无法下载-网络问题」。绕法：

```bash
# 在目标目录起一个简单文件服务
cd /path/to/assets && nohup python -m http.server 8899 --bind 127.0.0.1 &
# 再开一条 SSH 本地转发，浏览器直接 http://127.0.0.1:8899/文件名 下载
```

### 1.4 版本与路径

- 镜像：`quay.io/ascend/vllm-omni:v0.25.0-a3`（910C/A3）。
- 竞赛 Python：`/usr/local/python3.12.13/bin`（已写入 `~/.bashrc` 则免手动）。
- 依赖安装用阿里云 PyPI 源；`step-audio2` 必须 `--no-deps`（防覆盖镜像锁定 torch/torch_npu）。
- 若 IDE 弹「Select dependencies to install」：**不要装**，会破坏 NPU 环境。

---

## 2. 模型服务与评测跑法

### 2.1 serve / bench 的 model id 必须对齐

- serve 用本地权重路径启动、**不加** `--served-model-name` 时，`/v1/models` 的 id 就是那个本地路径。
- `vllm bench` 客户端：`--model` 用本地路径（HF 名会 OSError）；请求体里的 model 必须等于 serve 暴露的 id，否则 `HTTP 404 model does not exist`。
- 换 serve 参数（如加 served-model-name）后，bench 命令也要跟着改。

### 2.2 官方性能 harness 内网跑法

```bash
# 1) 改测试配置两处（改前备份 .bak）：server_params.model → 本地模型路径；
#    dataset_path → 本地 seed-tts 数据根（含 en/meta.lst）
# 2) 装依赖
pip install pytest-asyncio
# 3) 跑（-k 过滤 A3 格；结果写 $BENCHMARK_DIR）
BENCHMARK_DIR=/path/to/out python -m pytest -s -v \
  tests/dfx/perf/scripts/run_benchmark.py \
  --test-config-file tests/dfx/perf/tests/test_minicpmo_4_5.json \
  -k test_minicpmo_4_5_challenge
```

- harness 会自起服务，跑前先停手动 serve 腾 NPU。
- vllm/vllm-omni 版本 mismatch 警告无害。

### 2.3 WER / SIM 打分（seed-tts-eval）

- 依赖：`pip install jiwer zhon`；打分模型（whisper-large-v3、wavlm）提前下载缓存。
- **离线环境必须 `HF_HUB_OFFLINE=1`**，否则初始化会去连 HuggingFace 卡死/失败。
- transformers 5.x：whisper-large-v3 缓存经常缺 `processor_config.json`，手动补：
  ```json
  {"processor_class": "WhisperProcessor"}
  ```
  放到 `~/.cache/huggingface/hub/models--openai--whisper-large-v3/snapshots/<hash>/`。
- SIM：`SEED_TTS_SIM_EVAL=1`；若数据集没有内嵌参考音频，需加 `--seed-tts-file-ref-audio <路径>`，否则 SIM 整列静默缺失。
- WER 输出是 jiwer 比率，对照门禁要 ×100 换算成百分数。

### 2.4 结果落盘与崩溃

- `vllm bench` 默认不落 JSON，记得 `--save-result --result-dir /path/to/bench_results`。
- `corrupted size vs. prev_size`（glibc teardown 崩溃）见得多：**只要 JSON 已落盘就无害**；没落盘就重跑一次。
- 日志建议重定向到持久目录：`/workspace/user_data/`（容器重建不丢）。

### 2.5 已知性能/稳定性边界

- 单 serve 实例累计请求数超过约 350 后可能崩崖退化（速度骤降）；本地大样本评测建议分批或定案到 200 条左右，全量留给官方复测环境。
- 全量精度测试很耗时：Daily-Omni 1197 条约 1 小时；Video-MME 数据约 95GB，先确认磁盘。
- 多卡布局（如双 die 分离 thinker/talker）对轮间开销无明显收益，属负结果，做之前先想清楚假设。

---

## 3. 性能优化经验

### 3.1 有效与待验证的 knob

- **`token2wav_n_timesteps: 3`（有效）**：把 vocoder 步数从默认降到 3，RTF 显著下降（团队实测 64@4 的 RTF 从 1.27 → 0.61，约 -52%），且 WER/SIM 零损失、启动稳定。
  - 位置：`connectors.connector_of_shared_memory.extra`，不要放 stage 顶层（会被忽略）。
  - 不建议降到 2：同行情报显示 2 步会启动失败，3 步是甜点。
- **`connector_get_sleep_s: 0.001`（待归因）**：有同队分享称 minicpmo 链路无消费端、改配置零效果。建议做单变量 A/B 确认后再写进报告（配置简化 + 归因干净）。
- **`repetition_penalty: 1.0`（确认有效）**：官方部署文档某处写的 1.2 是错值，官方 CI 用 1.0；精度跑分用 1.0。

### 3.2 单变量 A/B 纪律（重要）

1. 只改一个变量，同机同命令对照。
2. **核对配置真的生效**：改完 `grep` 确认；记录 yaml 的 mtime 和测试运行时刻，防止「改了但没生效」的误判（我们抓过一次把旧配置结果当新配置的误标）。
3. 每轮优化后复跑精度红线（Daily-Omni 全量）与 WER/SIM 快测。
4. 负结果也记录（如多卡布局），提交报告写出来更可信。
5. 报告方法论建议：A→B→A + sha256 哈希冻结（commit/yaml/结果 JSON 全哈希）。

### 3.3 卡时与排队意识

- 每次长测试先估算耗时与卡时成本；全量精度（Daily-Omni/Video-MME）按小时计。
- 长任务串行排队，别在同一块 NPU 上同时起两个重活。

---

## 4. 自动化与脚本纪律

### 4.1 自治脚本模式（断连不丢）

推荐把「多阶段长任务」包成一个脚本，一次令牌点着：

```bash
#!/bin/bash
export PATH=/usr/local/python3.12.13/bin:$PATH
export HF_HUB_OFFLINE=1
LOG=/workspace/user_data/phase.log
echo "[phase] start $(date '+%F %T')" > $LOG

# 起 serve（脱离连接）
nohup env VLLM_WORKER_MULTIPROC_METHOD=spawn vllm serve <模型路径> \
  --omni --trust-remote-code --deploy-config <yaml> \
  --stage-init-timeout 600 --host 127.0.0.1 --port 8091 \
  </dev/null >/workspace/user_data/serve.log 2>&1 &

# 等健康
for i in $(seq 1 180); do
  curl -s -m 3 http://127.0.0.1:8091/v1/models >/dev/null 2>&1 && break
  sleep 10
done

# 跑测试（脱离连接）
nohup vllm bench serve ... --save-result --result-dir ... \
  </dev/null >/workspace/user_data/bench.log 2>&1 &

# 完成标志
echo "ALL_DONE $(date '+%F %T')" >> $LOG
```

回来看三个东西：完成标志、结果 JSON、进程列表。

### 4.2 常见脚本坑

- **单行命令限制**：批量执行器按行拆命令，多行 `python -c` / heredoc 会被拆坏；要么写单行（`;` 拼接），要么先落成 `.sh` 再执行。
- **后台进程占住通道**：nohup 的子进程记得 `</dev/null >log 2>&1`，否则 exec 通道不关闭，命令「跑完却一直挂着」。
- **僵尸进程**：容器 PID 1 不回收；判断进程结束用 `/proc/<pid>/stat` 的 `Z` 状态：
  ```bash
  while [ -d /proc/<pid> ]; do
    [ "$(awk '{print $3}' /proc/<pid>/stat)" = "Z" ] && break
    sleep 20
  done
  ```
- **Windows PowerShell 传 JSON 给 curl**：双引号会被吞，报 `Expecting property name enclosed in double quotes`；把 JSON 写文件再用 `--data-binary @file`。

---

## 5. 安全与隐私提醒（务必遵守）

- 令牌、SSH 私钥、账号密码属于敏感凭据：**不要**写进脚本、日志、提交物或群文档；提交前全文扫描。
- 不要在提交压缩包里包含 `.ssh/`、`token` 类文件或本地绝对路径。
- 分享经验时只写「做法 + 现象 + 解法」，不要贴带令牌的连接命令。
- 容器内日志如果含请求体/用户输入，提交前确认是否需要脱敏。

---

## 6. 完整评测检查清单（跑一次优化闭环）

1. 环境核对：python 路径、NPU 可见、模型路径、数据路径。
2. 起 serve（含所需 flag：`--interleave-mm-strings`、`--allowed-local-media-path` 视任务而定），等 `/v1/models` 健康。
3. 性能：官方 harness 三格 + duplex；直连 bench 做 A/B 对照。
4. 精度：Daily-Omni 全量（红线最紧）、Video-MME 全量、WER/SIM 快测。
5. Demo：官方 demo 五项（文本+语音 / 图 / 音频 / 视频 / 多轮），录演示视频。
6. 提交物：完整代码与配置、三基准原始输出、性能报告（A/B 前后）、Demo 说明、A→B→A 方法论 + 哈希冻结。

---

*整理：小博（Codex 执行端）· 2026-08-13 · 仅供群内交流学习*
