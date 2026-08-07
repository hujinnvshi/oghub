# MiniCPM\-o 4\.5 昇腾 910C 部署上手指南

## 1\. 环境说明与前置检查

镜像选择： CANN

验证环境：Ubuntu 22\.04 容器（宿主机内核 openEuler 2203 SP4）、CANN 9\.1\.0\-beta\.1、Ascend 910C。

### 1\.1 当前环境特征

```Bash
# 系统信息
uname -a
# Linux xxxxx 5.10.0-216.0.0.115.oe2203sp4.aarch64 #1 SMP ... aarch64 GNU/Linux

cat /etc/os-release | head -5
# PRETTY_NAME="Ubuntu 22.04.5 LTS"

# NPU
npu-smi info
# 应能看到 Ascend910 设备，Health OK

# CANN
ls -d /usr/local/Ascend/cann-*
# /usr/local/Ascend/cann-9.1.0-beta.1

# 工具检查
which gcc g++ cmake make git python3 pip
```

### 1\.2 重要约束

|约束|说明|
|---|---|
|**当前环境本身是一个 Docker 容器**|`/proc/1/cgroup` 显示 `/docker/...`，所以**不能在容器内再安装/运行 Docker**|
|**GitHub / HuggingFace 无法访问**|需要国内镜像下载源码，模型权重建议从modelscope仓库下载|
|**文档原生面向 NVIDIA CUDA**|在昇腾上必须把后端改成 **CANN**|
|**llama\.cpp CANN 后端对量化格式支持有限制**|实测 `Q4_K_M` 会退到 CPU，速度极慢；**FP16 在 CANN 上最快**|

## 2\. 模型下载

### 2\.1 需要下载哪些文件

在 `/workspace/MiniCPM-o-4_5-gguf/` 目录下，必须保持如下结构：

```Plaintext
MiniCPM-o-4_5-gguf/
├── MiniCPM-o-4_5-F16.gguf              # LLM 主模型（推荐 FP16，CANN 最快）
├── audio/
│   └── MiniCPM-o-4_5-audio-F16.gguf    # 音频编码器（Whisper）
├── vision/
│   └── MiniCPM-o-4_5-vision-F16.gguf   # 视觉编码器（SigLip2）
├── tts/
│   ├── MiniCPM-o-4_5-tts-F16.gguf      # TTS 模型
│   └── MiniCPM-o-4_5-projector-F16.gguf# TTS projector
└── token2wav-gguf/                     # 声码器（开启 TTS 语音输出时必需）
    ├── encoder.gguf
    ├── flow_matching.gguf
    ├── flow_extra.gguf
    ├── hifigan2.gguf
    └── prompt_cache.gguf
```

> 如果只跑纯文本/音频、不需要语音合成，可以只下 LLM \+ audio；TTS 相关文件可暂不下载。

### 2\.2 从 ModelScope 下载（推荐）

当前环境 HuggingFace 不通，ModelScope 可正常访问。

```Bash
# 安装 modelscope（如未安装）
/usr/local/python3.12.13/bin/pip install -U modelscope

# 查看仓库里有哪些文件
/usr/local/python3.12.13/bin/python3 - <<'PY'
from modelscope.hub.api import HubApi
api = HubApi()
for f in api.get_model_files('OpenBMB/MiniCPM-o-4_5-gguf', recursive=True):
    if f['Path'].endswith('.gguf'):
        print(f"{f['Size']:>12}  {f['Path']}")
PY
```

#### 按需下载模型权重文件（避免下不需要的量化版本）

本次赛事赛道二**应用创新赛道推荐**使用MiniCPM\-o\-4\_5\-F16\.gguf权重版本，其他量化权重版本在CANN环境下性能会有损失，对于应用赛道选手建议可以直接使用FP16精度版本。

```Bash
cd /workspace
/usr/local/python3.12.13/bin/python3 - <<'PY'
from modelscope.hub.file_download import model_file_download
import os

model_id = 'OpenBMB/MiniCPM-o-4_5-gguf'
local_dir = '/workspace/MiniCPM-o-4_5-gguf'

files = [
    'MiniCPM-o-4_5-F16.gguf',                 # ~16 GB
    'audio/MiniCPM-o-4_5-audio-F16.gguf',     # ~660 MB
    'vision/MiniCPM-o-4_5-vision-F16.gguf',   # ~1.1 GB
    'tts/MiniCPM-o-4_5-tts-F16.gguf',         # ~1.2 GB
    'tts/MiniCPM-o-4_5-projector-F16.gguf',   # ~15 MB
    'token2wav-gguf/encoder.gguf',            # ~145 MB
    'token2wav-gguf/flow_matching.gguf',      # ~438 MB
    'token2wav-gguf/flow_extra.gguf',         # ~14 MB
    'token2wav-gguf/hifigan2.gguf',           # ~80 MB
    'token2wav-gguf/prompt_cache.gguf',       # ~212 MB
]

for f in files:
    print(f"[DOWNLOAD] {f}")
    path = model_file_download(model_id, f, local_dir=local_dir)
    print(f"[DONE]     {path}  ({os.path.getsize(path)} bytes)")
PY
```

### 2\.3 校验文件完整性

```Bash
cd /workspace/MiniCPM-o-4_5-gguf
find . -maxdepth 3 -type f -name "*.gguf" -exec ls -lh {} \;
```

参考大小：

|文件|大小|
|---|---|
|`MiniCPM-o-4_5-F16.gguf`|16,384,959,136 bytes|
|`audio/MiniCPM-o-4_5-audio-F16.gguf`|660,167,904 bytes|
|`vision/MiniCPM-o-4_5-vision-F16.gguf`|1,095,113,184 bytes|
|`tts/MiniCPM-o-4_5-tts-F16.gguf`|1,157,244,416 bytes|
|`tts/MiniCPM-o-4_5-projector-F16.gguf`|14,948,640 bytes|
|`token2wav-gguf/prompt_cache.gguf`|211,613,152 bytes|

## 3\. 获取 llama\.cpp\-omni 源码

### 3\.1 直接 clone（需要能访问 GitHub）

```Bash
git clone --depth 1 https://github.com/tc-mb/llama.cpp-omni.git
```

### 3\.2 国内环境：通过代理 clone

在本文验证环境里，GitHub 直接访问超时，以下代理测试有效：

```Bash
# 推荐：v4.gh-proxy.org
git clone --depth 1 https://v4.gh-proxy.org/https://github.com/tc-mb/llama.cpp-omni.git
```

其他可尝试的代理（网络环境不同可能效果不同）：

```Bash
# ghproxy.net（下载 zip 可用，git clone 较慢）
git clone --depth 1 https://ghproxy.net/https://github.com/tc-mb/llama.cpp-omni.git

# gitclone.com（本次测试 502，不稳定）
git clone --depth 1 https://gitclone.com/github.com/tc-mb/llama.cpp-omni.git
```

### 3\.3 源码目录说明

```Bash
cd /workspace/llama.cpp-omni
ls
# 关键目录：
#   CMakeLists.txt
#   tools/omni/         # CLI、convert、test
#   tools/server/       # llama-omni-server 源码
#   docs/backend/CANN.md # CANN 后端官方说明
```

## 4\. 编译

### 4\.1 配置 CMake

在昇腾上必须显式启用 `GGML_CANN`，并关闭 OpenSSL（避免 HTTPS 证书问题）：

```Bash
cd /workspace/llama.cpp-omni

cmake -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DGGML_CANN=ON \
    -DLLAMA_OPENSSL=OFF
```

正常应输出：

```Plaintext
-- CANN: updated CANN_INSTALL_DIR from ASCEND_TOOLKIT_HOME=/usr/local/Ascend/cann-9.1.0-beta.1
-- CANN: SOC_VERSION auto-detected is:AscendAscend910
-- CANN: Including CANN backend
-- Generating done
```

### 4\.2 编译目标

```Bash
cd /workspace/llama.cpp-omni
cmake --build build --config Release -j \
    --target llama-omni-server \
             llama-omni-cli
```

编译完成后产物：

```Bash
ls -lh build/bin/llama-omni-*
# build/bin/llama-omni-server
# build/bin/llama-omni-cli
```

### 4\.3 编译常见问题

|现象|原因/解决|
|---|---|
|`GGML_CANN` 未生效|检查 `ASCEND_TOOLKIT_HOME` 是否指向正确 CANN 目录|
|OpenSSL 相关编译失败|加 `-DLLAMA_OPENSSL=OFF`|
|找不到 `libascendcl.so`|运行前确保 `LD_LIBRARY_PATH` 包含 `/usr/local/Ascend/cann-*/lib64` 和 `build/bin`|

## 5\. 启动服务

### 5\.1 启动脚本

创建 `/workspace/llama.cpp-omni/start_server.sh`：

```Bash
#!/bin/bash
set -e

cd "$(dirname "$0")"

MODEL="/workspace/MiniCPM-o-4_5-gguf/MiniCPM-o-4_5-F16.gguf"
HOST="0.0.0.0"
PORT="28099"
CTX="4096"
NGL="99"

# 让二进制找到编译出的共享库
export LD_LIBRARY_PATH="$(pwd)/build/bin:${LD_LIBRARY_PATH}"

exec ./build/bin/llama-omni-server \
    -m "$MODEL" \
    --host "$HOST" \
    --port "$PORT" \
    -c "$CTX" \
    -ngl "$NGL"
```

赋予执行权限并启动：

```Bash
chmod +x /workspace/llama.cpp-omni/start_server.sh
cd /workspace/llama.cpp-omni
./start_server.sh
```

### 5\.2 后台运行

```Bash
cd /workspace/llama.cpp-omni
nohup ./start_server.sh > /tmp/llama-omni-server.log 2>&1 &
```

### 5\.3 验证服务

```Bash
curl http://127.0.0.1:28099/health
# 期望输出：{"engine":"comni","status":"ok"}
```

### 5\.4 参数说明

|参数|含义|本次设置|
|---|---|---|
|`-m`|LLM GGUF 路径|`/workspace/MiniCPM-o-4_5-gguf/MiniCPM-o-4_5-F16.gguf`|
|`--host`|监听地址|`0.0.0.0`（允许外部访问）|
|`--port`|端口|`28099`|
|`-c`|上下文长度|`4096`|
|`-ngl`|放到 GPU/NPU 的层数|`99`（尽量全部 offload）|

## 6\. API 测试

> 服务同时提供两套协议：

- **WebSocket ****`/backend`**：推荐，Demo 使用

- **HTTP Legacy API（SSE）**：`/v1/stream/omni_init`、`/v1/stream/prefill`、`/v1/stream/decode`

### 6\.1 安装 Python 依赖

```Bash
/usr/local/python3.12.13/bin/pip install websocket-client numpy
```

### 6\.2 WebSocket 文本测试

创建 `test_ws_text.py`：

```Python
#!/usr/bin/env python3
import websocket, json, time

HOST = "127.0.0.1"
PORT = 28099

ws = websocket.WebSocket()
ws.connect(f"ws://{HOST}:{PORT}/backend", timeout=60)
ws.settimeout(300)

start = time.time()

# 1) init session
ws.send(json.dumps({
    "type": "session.init",
    "payload": {"mode": "turn_based", "use_tts": False}
}))
msg = json.loads(ws.recv())
print(f"[{time.time()-start:.2f}s] {msg['type']}")

# 2) send text
ws.send(json.dumps({
    "type": "input.append",
    "input": {
        "messages": [{"role": "user", "content": "用一句话介绍你自己"}],
        "streaming": True,
        "generation": {"max_new_tokens": 128}
    }
}))

text = ""
while True:
    msg = json.loads(ws.recv())
    t = time.time() - start
    if msg["type"] == "response.output.delta" and msg.get("kind") == "text":
        text += msg.get("text", "")
    elif msg["type"] == "response.done":
        print(f"[{t:.2f}s] response.done")
        break
    elif msg["type"] == "error":
        print(f"[{t:.2f}s] error:", msg)
        break

print(f"\n总耗时: {time.time()-start:.2f}s")
print(f"回复: {text}")
ws.close()
```

运行：

```Bash
cd /workspace/llama.cpp-omni
/usr/local/python3.12.13/bin/python3 test_ws_text.py
```

### 6\.3 WebSocket 音频测试

音频以 **base64 float32 PCM** 形式嵌入 `messages[].content`：

```Python
#!/usr/bin/env python3
import websocket, json, time, base64, wave, numpy as np

HOST = "127.0.0.1"
PORT = 28099
AUDIO_PATH = "tools/omni/assets/test_case/audio_test_case/audio_test_case_0001.wav"

with wave.open(AUDIO_PATH, 'rb') as w:
    raw = w.readframes(w.getnframes())
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    audio_b64 = base64.b64encode(samples.astype(np.float32).tobytes()).decode('ascii')

ws = websocket.WebSocket()
ws.connect(f"ws://{HOST}:{PORT}/backend", timeout=60)
ws.settimeout(300)

start = time.time()

ws.send(json.dumps({
    "type": "session.init",
    "payload": {"mode": "turn_based", "use_tts": False}
}))
print(f"[{time.time()-start:.2f}s] {json.loads(ws.recv())['type']}")

ws.send(json.dumps({
    "type": "input.append",
    "input": {
        "messages": [{
            "role": "user",
            "content": [{"type": "audio", "data": audio_b64}]
        }],
        "streaming": True,
        "generation": {"max_new_tokens": 128}
    }
}))

text = ""
while True:
    msg = json.loads(ws.recv())
    if msg["type"] == "response.output.delta" and msg.get("kind") == "text":
        text += msg.get("text", "")
    elif msg["type"] == "response.done":
        break
    elif msg["type"] == "error":
        print("error:", msg)
        break

print(f"总耗时: {time.time()-start:.2f}s")
print(f"回复: {text}")
ws.close()
```

### 6\.4 HTTP Legacy API 音频测试

```Bash
#!/bin/bash
set -e

HOST="127.0.0.1"
PORT="28099"
BASE="http://${HOST}:${PORT}"

AUDIO_0000="tools/omni/assets/test_case/audio_test_case/audio_test_case_0000.wav"
AUDIO_0001="tools/omni/assets/test_case/audio_test_case/audio_test_case_0001.wav"

echo "=== 1) omni_init ==="
curl -s -X POST "${BASE}/v1/stream/omni_init" \
  -H 'Content-Type: application/json' \
  -d "{\"media_type\":1,\"use_tts\":false,\"output_dir\":\"./tools/omni/output_http_test\",\"voice_audio\":\"${AUDIO_0000}\"}"
echo ""

echo "=== 2) prefill user audio ==="
# 注意：因为 omni_init 已用 voice_audio 占用 index=0，所以用户音频 cnt=1
curl -s -X POST "${BASE}/v1/stream/prefill" \
  -H 'Content-Type: application/json' \
  -d "{\"audio_path_prefix\":\"${AUDIO_0001}\",\"cnt\":1}"
echo ""

echo "=== 3) decode ==="
curl -s -N --max-time 30 -X POST "${BASE}/v1/stream/decode" \
  -H 'Content-Type: application/json' \
  -d '{"stream":true,"debug_dir":"./tools/omni/output_http_test","n_predict":128}'
echo ""
```

## 7\. 常见问题与坑

### 7\.1 量化格式选择

|格式|CANN 支持|实测速度|建议|
|---|---|---|---|
|`F16`|✅ 原生支持|\~50 tokens/s|**指定权重版本**|

### 7\.2 WebSocket 连接被立即关闭

原因：使用了 `websockets` 库，其默认 keepalive ping 在模型加载期间超时。

解决：使用 `websocket-client` 库，并关闭 ping：

```Python
ws = websocket.WebSocket()
ws.connect("ws://127.0.0.1:28099/backend", timeout=60)
ws.settimeout(300)
```

### 7\.3 HTTP prefill 后 decode 立即结束，无输出

原因：`cnt` 起始值错了。

规则：

- `omni_init` 传了 `voice_audio` → 系统提示占用 `index=0` → 用户音频用 `cnt=1`

- `omni_init` 没传 `voice_audio` → 用户音频用 `cnt=0`

### 7\.4 HTTP 与 WebSocket 混用导致崩溃

`llama-omni-server` 目前只支持 **一个活跃 session**。如果先连 WebSocket 再调 HTTP，或在 HTTP 多轮之间未正确重置，可能在 `vision_free` 时触发 CANN 空上下文崩溃。

建议：**生产环境选定一种协议，不要交替使用。**

### 7\.5 视觉模态未验证

当前 `vision_backend` 默认值为 `metal`，在 Linux/昇腾上不是最优。文本和音频已稳定，视觉输入需进一步适配。

## 8\. 后续可继续测试的内容

1. **systemd 服务化**：写成系统服务，开机自启、异常重启

2. **视觉后端适配**：将 `vision_backend` 改为 CPU/CANN 路径，验证图文输入

3. **多卡负载均衡**：当前自动使用两块 NPU，可进一步测试 `--split-mode` 参数

4. **TTS 语音输出**：开启 `use_tts=true`，验证语音合成链路

5. **接入 MiniCPM\-o\-Demo 前端**：用 WebSocket `/backend` 对接官方 Web UI

