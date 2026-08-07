# 在昇腾 NPU 上使用 vllm\-omni部署 MiniCPM\-o 4\.5

本指南介绍如何在昇腾（Ascend）NPU 上用 vLLM\-Omni 部署 MiniCPM\-o 4\.5（文本 / 图像 / 音频 / 视频理解 \+ 语音输出）。



已验证环境：Atlas A3（910C），Ubuntu 22\.04 容器，CANN 商用镜像。Atlas A2（910B）步骤相同，仅镜像 tag 不同。



**说明**：通用 NPU 安装见 https://github\.com/vllm\-project/vllm\-omni/blob/main/docs/getting\_started/installation/npu\.md 。本文补充 MiniCPM\-o 4\.5 特有的依赖（Token2Wav / step\-audio2）、模型权重下载与整机启动验证流程。



后续大家的优化合入到minicpm\-challenge分支

`详细：``https://github.com/vllm-project/vllm-omni.git`` -b minicpm-challenge`



## 0\. 前置检查



在宿主机（或已挂载 NPU 的容器）上确认驱动与设备正常：



```Shell
uname -a
cat /etc/os-release | head -5
npu-smi info
ls -d /usr/local/Ascend/driver
cat /usr/local/Ascend/driver/version.info
```



**警告**：若当前环境本身已是 Docker 容器（`cat /proc/1/cgroup` 出现 `/docker/`），则无法在其中再启动 Docker，请直接在宿主机创建部署容器。



**警告**：内网通常无法访问 GitHub / HuggingFace。镜像用国内源，代码用镜像站，模型权重从 ModelScope 下载：https://modelscope\.cn



## 1\. 拉取镜像

https://hidevlab\.huawei\.com/online\-develop 上拉取镜像选择自定义镜像，并且根据硬件类型选择镜像地址。910B的镜像选择如下：

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=NGI5M2JmNWQzMTRjNzYwNWEwYjUwYTNlM2UxODcwY2ZfODVlZmE1YTQzYmJmNDc0YWNkMGFlZTNjNGM0M2IxY2RfSUQ6NzY2NzQ2MDUzNDE3ODg1OTk4MF8xNzg2MDY5Nzk3OjE3ODYxNTYxOTdfVjM)

预构建昇腾镜像页面：https://quay\.io/repository/ascend/vllm\-omni?tab=tags



Atlas A2（910B）官方镜像：`quay.io/ascend/vllm-omni:v0.25.0`



Atlas A2（910B）国内镜像：`quay.nju.edu.cn/ascend/vllm-omni:v0.25.0`



Atlas A3（910C）官方镜像：`quay.io/ascend/vllm-omni:v0.25.0-a3`



Atlas A3（910C）国内镜像：`quay.nju.edu.cn/ascend/vllm-omni:v0.25.0-a3`



```Shell
docker pull quay.nju.edu.cn/ascend/vllm-omni:v0.25.0-a3
```



## 2\. 创建容器



将 NPU 设备与驱动目录挂载进容器。下面以 4 卡（davinci0\-3）为例。单卡时按需删减对应的 `--device /dev/davinciN`。



```Shell
docker run --rm \
    --name vllm-omni-a3 \
    --shm-size=4g \
    --device /dev/davinci0 \
    --device /dev/davinci1 \
    --device /dev/davinci2 \
    --device /dev/davinci3 \
    --device /dev/davinci_manager \
    --device /dev/devmm_svm \
    --device /dev/hisi_hdc \
    -v /usr/local/dcmi:/usr/local/dcmi \
    -v /usr/local/bin/npu-smi:/usr/local/bin/npu-smi \
    -v /usr/local/Ascend/driver/lib64/:/usr/local/Ascend/driver/lib64/ \
    -v /usr/local/Ascend/driver/version.info:/usr/local/Ascend/driver/version.info \
    -v /etc/ascend_install.info:/etc/ascend_install.info \
    -v ~/.cache:/root/.cache \
    -p 8091:8091 \
    -it quay.nju.edu.cn/ascend/vllm-omni:v0.25.0-a3 bash
```



**提示**：`-p 8091:8091` 需与后续 `vllm serve --port` 保持一致。



**提示**：`-v ~/.cache:/root/.cache` 可复用宿主机 HuggingFace / ModelScope 缓存，避免重复下载。



**提示**：进入容器后先执行 `npu-smi info`，确认容器内能看到 NPU。



## 3\. 安装 MiniCPM\-o Token2Wav 依赖



MiniCPM\-o 4\.5 的语音输出（TTS）依赖 step\-audio2 系列的 flow / HiFiGAN 声码器与音频 tokenizer 资源：



```Shell
pip install stepaudio2-minicpmo
pip install step-audio2 --no-deps

#可更换pip源
pip install stepaudio2-minicpmo -i https://pypi.org/simple --trusted-host pypi.org --trusted-host files.pythonhosted.org 
pip install step-audio2 -i https://pypi.org/simple --trusted-host pypi.org --trusted-host files.pythonhosted.org --no-deps  #更换pip源
```



**说明**：为什么要用 `--no-deps`。step\-audio2 的部分传递依赖会与镜像内已锁定的 torch / torch\_npu 版本冲突，用 `--no-deps` 只装包体本身，复用镜像里的昇腾适配栈。



**说明**：在昇腾上，vLLM\-Omni 会优先使用内置的 MiniCPMO45Token2wav（in\-tree step\_audio2\_core 后端），而不是 stepaudio2 包里硬编码 `.cuda()` 的实现。上述依赖主要用于提供声码器权重加载所需的模块与资源。



## 4\. 安装 vLLM\-Omni



```Shell
git clone https://github.com/vllm-project/vllm-omni.git -b minicpm-challenge
cd vllm-omni
SETUPTOOLS_SCM_PRETEND_VERSION=0.25.0 pip install -e . 
或者
SETUPTOOLS_SCM_PRETEND_VERSION=0.25.0 pip install -e .  -i https://pypi.org/simple --trusted-host pypi.org --trusted-host files.pythonhosted.org 
export VLLM_WORKER_MULTIPROC_METHOD=spawn
```



**提示**：内网无法访问 github\.com 时，可用：



```Shell
git clone https://gitclone.com/github.com/vllm-project/vllm-omni.git
```



或：



```Shell
git clone https://ghproxy.net/https://github.com/vllm-project/vllm-omni.git
```



## 5\. 下载模型权重



目前机器上已挂载模型，**可直接使用/workspace/shared\_assets/models/OpenBMB路径下的模型**



如果共享目录下没有模型，则建议从 ModelScope 下载：

```Shell
pip install modelscope
modelscope download --model OpenBMB/MiniCPM-o-4_5 --local_dir /workspace/MiniCPM-o-4_5
```

若可访问 HuggingFace，也可直接用仓库名 `openbmb/MiniCPM-o-4_5`（首次运行时自动下载）。

## 6\. 启动服务



MiniCPM\-o 4\.5 是 thinker \+ talker \+ Token2Wav 的多阶段流水线。仓库自带部署配置 `vllm_omni/deploy/minicpmo_4_5.yaml` 已包含 `platforms.npu` 覆盖项，`--omni` 会自动加载：



```Shell
export VLLM_WORKER_MULTIPROC_METHOD=spawn

vllm serve /workspace/shared_assets/models/OpenBMB/MiniCPM-o-4_5 --omni \
    --served-model-name openbmb/MiniCPM-o-4_5 \
    --trust-remote-code \
    --deploy-config vllm_omni/deploy/minicpmo_4_5.yaml \
    --stage-init-timeout 600 \
    --host 0.0.0.0 --port 8091
```



关于 stage 与 NPU 设备分配，可编辑 `vllm_omni/deploy/minicpmo_4_5.yaml` 中的 `platforms.npu.stages`：



```YAML
platforms:
  npu:
    stages:
      - stage_id: 0
        max_num_batched_tokens: 8192
        compilation_config:
          cudagraph_mode: PIECEWISE
      - stage_id: 1
        max_num_batched_tokens: 8192
        compilation_config:
          cudagraph_mode: PIECEWISE
```



每个 stage 通过 `devices: "0"` 指定 NPU 序号。多卡时按物理卡号分配，例如 thinker 用 `"0"`，talker 用 `"1"`。



首次启动会编译图并加载声码器，`--stage-init-timeout 600` 用于给足初始化时间。



可用 `--deploy-config` 切换不同卡数布局：



- `minicpmo_4_5.yaml`：1 卡。thinker 与 talker\+Token2Wav 共用 NPU 0

- `minicpmo_4_5_2gpu.yaml`：2 卡。thinker 在 NPU 0，talker\+Token2Wav 在 NPU 1

- `minicpmo_4_5_3gpu.yaml`：3 卡。thinker 2 路 TP（NPU 0/1），talker 在 NPU 2

- `minicpmo_4_5_8x4090.yaml`：8 卡。thinker 4 路 TP（NPU 0\-3），talker 在 NPU 4

## 7\. 在线服务验证



服务就绪后（日志出现监听端口），用第 6 节启动的服务做验证，端口为 8091。



### 7\.1 文本冒烟测试



```Shell
curl http://127.0.0.1:8091/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"model":"openbmb/MiniCPM-o-4_5","messages":[{"role":"user","content":"用一句话介绍你自己"}],"max_tokens":128}'
```



### 7\.2 多模态输入与语音输出（curl）

手写请求若要语音输出，`use_tts_template` 必须放在请求根部,不要放在`extra_body`中。curl 不会展开嵌套的 `extra_body`：



```Shell
curl http://127.0.0.1:8091/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{
    "model":"openbmb/MiniCPM-o-4_5",
    "messages":[{"role":"user",
    "content":"先打个招呼，再用一句话介绍 vLLM。"}],
    "modalities":["text","audio"],
    "chat_template_kwargs":{"use_tts_template":true}
    }'
```



返回音频为 base64 编码的 24 kHz 单声道 WAV，字段路径为 `choices[].message.audio.data`。



### 7\.3 OpenAI Python 客户端



```Shell
cd examples/online_serving/minicpmo
python openai_chat_completion_client_for_multimodal_generation.py --query-type use_image --host localhost --port 8091
python openai_chat_completion_client_for_multimodal_generation.py --query-type text --modalities text --port 8091 --prompt "用一句话介绍你自己。"
```

注: 如果没有网络可能image下载失败，优先使用文本进行测试即\-\-query\-type text

### 7\.4 Gradio Demo



```Shell
bash examples/online_serving/minicpmo/run_gradio_demo.sh
```



或：



```Shell
python examples/online_serving/minicpmo/gradio_demo.py \
    --minicpmo45-api-base http://localhost:8091/v1 \
    --minicpmo45-model openbmb/MiniCPM-o-4_5 \
    --port 7862
```



打开 `http://<host>:7862`。取消勾选 Generate speech output \(TTS\) 即为纯文本回复。



### 7\.5 输出模态控制



- `["text"]`：仅文本，不追加 TTS bos

- `["text", "audio"]` 或不设置：文本 \+ 24 kHz 语音

语音输出需要 `chat_template_kwargs.use_tts_template=true`。curl 放在请求根部；OpenAI Python SDK 可放在 `extra_body`，SDK 会合并到根部。



更完整说明：https://github\.com/vllm\-project/vllm\-omni/blob/main/examples/online\_serving/minicpmo/README\.md

### **7\.6 跑 Seed\-TTS 数据集**



用 `vllm bench serve` 对 Seed\-TTS 做 TTS 吞吐 / 时延评测（文本 \+ 音频输出）。模型路径、服务端口与第 5 / 6 节一致：`/workspace/shared_assets/models/OpenBMB/MiniCPM-o-4_5`、`8091`。



#### **7\.6\.1 下载数据集**



数据来源：https://huggingface\.co/datasets/zhaochenyang20/seed\-tts\-eval （含 `en/`、`zh/` 的 `meta.lst` 与 `prompt-wavs/`）。



```Shell
modelscope download --dataset CowboyZ/seed-tts-eval seedtts_testset.tar --local_dir /workspace/seed-tts
#或者使用共享盘的数据集 /workspace/shared_assets/datasets/CowboyZ/seed-tts-eval
```



注意用 `hf` 而不是 `huggingface-cli`：`huggingface_hub>=1.0` 起旧命令已废弃，执行会直接报 `huggingface-cli is deprecated and no longer works`。



只下英文标准集时可加：`--include "en/meta.lst" "en/prompt-wavs/**"`。内网若无法访问 HuggingFace，需提前把数据集拷到 `/workspace/seed-tts-eval`。



这一步也可以省略：`--dataset-path` 直接填仓库名 `zhaochenyang20/seed-tts-eval` 时，bench 会按 `--seed-tts-locale` 只拉取对应语种子目录。



#### **7\.6\.2 启动服务**



按第 6 节启动即可（Seed\-TTS 默认把参考音频打成 inline base64，一般不必加 `--allowed-local-media-path`）：



```Shell
export VLLM_WORKER_MULTIPROC_METHOD=spawn

vllm serve /workspace/shared_assets/models/OpenBMB/MiniCPM-o-4_5 --omni \
    --served-model-name openbmb/MiniCPM-o-4_5 \
    --trust-remote-code \
    --deploy-config vllm_omni/deploy/minicpmo_4_5.yaml \
    --stage-init-timeout 600 \
    --host 0.0.0.0 --port 8091
```



#### **7\.6\.3 发送评测请求**



若要算 WER，先装打分依赖（Whisper\-large\-v3 / Paraformer\-zh \+ jiwer，首次运行会下载 ASR 模型）：

服务就绪后执行：

```Shell
vllm bench serve \
  --omni \
  --port 8091 \
  --trust-remote-code \
  --max-concurrency 1 \
  --num-warmup 3 \
  --dataset-name seed-tts \
  --dataset-path /workspace/seed-tts-eval \
  --num-prompts 32 \
  --no-oversample \
  --seed-tts-wer-eval \
  --seed-tts-wer-save-items \
  --model openbmb/MiniCPM-o-4_5 \
  --endpoint /v1/chat/completions \
  --backend openai-chat-omni \
  --percentile-metrics ttft,tpot,itl,e2el,audio_ttfp,audio_rtf \
  --extra_body '{"modalities": ["text", "audio"], "chat_template_kwargs": {"enable_thinking": false, "use_tts_template": true}}'
```



说明：



- `--dataset-name seed-tts`：走 Seed\-TTS 数据模块；可用 `--seed-tts-locale en|zh` 选语种（默认 `en`）

\- \`\-\-seed\-tts\-wer\-eval\`：**必加**，否则不保留合成音频 PCM，WER 完全不会计算

- `--seed-tts-wer-save-items`：在上一项基础上，结果 JSON 里额外保存逐条 ASR / WER 明细（键名 `seed_tts_wer_eval_items`）；单独加它不生效

- `--extra_body` 必须带 `"modalities": ["text", "audio"]` 与 `"use_tts_template": true`，否则不会走 TTS

- `--percentile-metrics` 中的 `audio_ttfp` / `audio_rtf` 用于看首包音频时延与实时率

- 若改用 `file://` 参考音频（`--seed-tts-file-ref-audio`），serve 需加 `--allowed-local-media-path /workspace/seed-tts-eval`

#### **7\.6\.4 评测结果参考**



上述命令（`en` 语种、32 条、并发 1）的实测数值：



|指标|数值|
|---|---|
|Mean TTFT \(ms\)|333\.26|
|Mean TTFP \(ms\)|986\.47|
|RTF|0\.44|

TTFP 是首个音频包延迟，比 TTFT 多出的部分是 Talker \+ Token2Wav 的启动开销。RTF 0\.44 表示合成速度约为实时的 2\.3 倍。数值随硬件、并发和参考音频长度变化，仅供对照

### **7\.7 跑 Daily\-Omni 数据集**



Daily\-Omni 用 MiniCPM 官方交错 packing（1fps 帧与 1s 音频交替）测视听 MCQ 准确率。模型仍用 `/workspace/shared_assets/models/OpenBMB/MiniCPM-o-4_5`，服务端口 `8091`；数据放在 `/workspace/Daily-Omni`。



#### **7\.7\.1 下载数据集**



数据来源：https://huggingface\.co/datasets/liarliar/Daily\-Omni （需 `qa.json` 与 `Videos.tar`）。



```Shell
modelscope download --dataset MTEB/Daily-Omni --local_dir /workspace/MTEB/Daily-Omni

#或者直接使用共享盘下的数据集  /workspace/shared_assets/datasets/MTEB/Daily-Omni

```

同样用 `hf` 而不是已废弃的 `huggingface-cli`。



`Videos.tar` 约 4GB，解压后更大。`--daily-omni-input-mode all` 依赖每个子目录里的 `{id}_audio.wav`，解压后请确认存在。内网无法访问 HuggingFace 时，需提前把 `qa.json` 与解压后的 `Videos/` 放到 `/workspace/Daily-Omni`。

modelscope 数据集转换脚本

```Plain Text
python convert_daily_omni_modelscope.py \
  --src /workspace/MTEB/Daily-Omni \
  --dst /workspace/Daily-Omni 

```

```Python
#!/usr/bin/env python3
"""Convert the ModelScope ``MTEB/Daily-Omni`` parquet release into the official
``qa.json`` + ``Videos/`` layout consumed by ``vllm bench serve --dataset-name daily-omni``.

Source layout (``modelscope download --dataset MTEB/Daily-Omni --local_dir SRC``)::

    SRC/data/test-0000{0..9}-of-00010.parquet

with columns ``video_id``, ``video{bytes,path}``, ``audio{bytes,path}``, ``question``,
``candidates`` (list<string>), ``answer``.

Target layout::

    DST/qa.json
    DST/Videos/{video_id}/{video_id}_video.mp4
    DST/Videos/{video_id}/{video_id}_audio.wav

Three shape mismatches this script fixes:

1. ``answer`` holds the full option text ("D. Tax laws"), but the bench's
   ``evaluate_answer_official`` compares the model's bare letter against ``Answer``
   with a strict string match. Copying the text through scores 0%, so the leading
   letter is extracted.
2. The embedded WAV is named ``{video_id}_video.wav``; the bench resolves
   ``{video_id}_audio.wav``.
3. ``Type`` / ``video_category`` do not exist upstream of this release, so the
   per-task-type and per-category accuracy breakdowns degrade to ``unknown`` unless
   ``--official-qa`` supplies them. ``video_duration`` can instead be recovered from the
   media with ``--probe-duration``.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# Official qa.json only ever uses these two buckets.
_DURATION_BUCKETS = (30.0, 60.0)
_LETTER_RE = re.compile(r"^\s*\(?([A-D])\)?\s*[.、:：)\-]")

def _answer_letter(answer: str, candidates: list[str] | None) -> str:
    """Reduce a ModelScope ``answer`` to the official single-letter ``Answer``."""
    a = (answer or "").strip()
    if len(a) == 1 and a.upper() in "ABCD":
        return a.upper()
    m = _LETTER_RE.match(a)
    if m:
        return m.group(1)
    # Some rows repeat the option verbatim without its prefix; locate it in the choices.
    for c in candidates or []:
        if c.strip() == a:
            m = _LETTER_RE.match(c.strip())
            if m:
                return m.group(1)
    m = re.search(r"\b([A-D])\b", a.upper())
    return m.group(1) if m else ""

def _probe_duration_bucket(video_path: Path) -> str:
    """Snap the real MP4 duration to the nearest official ``30s`` / ``60s`` bucket."""
    try:
        import av
    except ImportError:
        return ""
    try:
        with av.open(str(video_path)) as container:
            duration = None
            if container.duration is not None:
                duration = container.duration / av.time_base
            else:
                stream = container.streams.video[0]
                if stream.duration is not None and stream.time_base is not None:
                    duration = float(stream.duration * stream.time_base)
    except Exception:
        return ""
    if not duration:
        return ""
    return f"{int(min(_DURATION_BUCKETS, key=lambda b: abs(b - duration)))}s"

def _load_official_index(path: Path) -> dict[tuple[str, str], dict[str, Any]]:
    """Index the official qa.json by ``(video_id, question)`` to re-attach lost metadata."""
    rows = json.loads(path.read_text(encoding="utf-8"))
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        key = (str(row.get("video_id", "")).strip(), str(row.get("Question", "")).strip())
        index[key] = row
    return index

def _blob(cell: Any, field: str) -> bytes | None:
    """Read ``bytes`` out of a struct cell that pyarrow decoded into a dict."""
    if not isinstance(cell, dict):
        return None
    value = cell.get(field)
    return value if isinstance(value, (bytes, bytearray)) else None

def convert(
    src: Path,
    dst: Path,
    official_qa: Path | None,
    probe_duration: bool,
    batch_size: int,
) -> None:
    import pyarrow.parquet as pq

    shards = sorted(src.glob("data/*.parquet")) or sorted(src.glob("*.parquet"))
    if not shards:
        raise SystemExit(f"No parquet shards found under {src} (expected data/*.parquet)")

    official = _load_official_index(official_qa) if official_qa else {}
    if official_qa:
        print(f"Loaded {len(official)} official rows for metadata merge", file=sys.stderr)

    videos_root = dst / "Videos"
    videos_root.mkdir(parents=True, exist_ok=True)

    qa_rows: list[dict[str, Any]] = []
    seen_media: set[str] = set()
    missing_letter = 0
    missing_meta = 0

    for shard in shards:
        print(f"[{shard.name}] reading", file=sys.stderr)
        pf = pq.ParquetFile(shard)
        for batch in pf.iter_batches(batch_size=batch_size):
            for row in batch.to_pylist():
                video_id = str(row.get("video_id") or "").strip()
                if not video_id:
                    continue

                # 1196 QA rows map onto 684 videos, so the media repeats; write it once.
                if video_id not in seen_media:
                    out_dir = videos_root / video_id
                    out_dir.mkdir(parents=True, exist_ok=True)
                    mp4 = out_dir / f"{video_id}_video.mp4"
                    wav = out_dir / f"{video_id}_audio.wav"
                    video_bytes = _blob(row.get("video"), "bytes")
                    audio_bytes = _blob(row.get("audio"), "bytes")
                    if video_bytes and not mp4.exists():
                        mp4.write_bytes(video_bytes)
                    if audio_bytes and not wav.exists():
                        wav.write_bytes(audio_bytes)
                    seen_media.add(video_id)

                question = str(row.get("question") or "").strip()
                candidates = [str(c) for c in (row.get("candidates") or [])]
                letter = _answer_letter(str(row.get("answer") or ""), candidates)
                if not letter:
                    missing_letter += 1

                entry: dict[str, Any] = {
                    "Question": question,
                    "Choice": candidates,
                    "Answer": letter,
                    "video_id": video_id,
                    "Type": "",
                    "video_category": "",
                    "video_duration": "",
                }

                ref = official.get((video_id, question))
                if ref is not None:
                    entry["Type"] = ref.get("Type", "")
                    entry["video_category"] = ref.get("video_category", "")
                    entry["video_duration"] = ref.get("video_duration", "")
                    for extra in ("content_parent_category", "content_fine_category"):
                        if extra in ref:
                            entry[extra] = ref[extra]
                else:
                    missing_meta += 1

                qa_rows.append(entry)

        print(f"[{shard.name}] done — {len(qa_rows)} QA rows, {len(seen_media)} videos", file=sys.stderr)

    if probe_duration:
        cache: dict[str, str] = {}
        for entry in qa_rows:
            if entry["video_duration"]:
                continue
            vid = entry["video_id"]
            if vid not in cache:
                cache[vid] = _probe_duration_bucket(videos_root / vid / f"{vid}_video.mp4")
            entry["video_duration"] = cache[vid]

    qa_path = dst / "qa.json"
    qa_path.write_text(json.dumps(qa_rows, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nWrote {qa_path} ({len(qa_rows)} rows)", file=sys.stderr)
    print(f"Wrote {videos_root} ({len(seen_media)} videos)", file=sys.stderr)
    if missing_letter:
        print(f"WARNING: {missing_letter} rows have no parseable A-D answer letter", file=sys.stderr)
    if official_qa and missing_meta:
        print(f"WARNING: {missing_meta} rows found no official metadata match", file=sys.stderr)
    if not official_qa:
        print(
            "NOTE: Type / video_category are empty (absent from the ModelScope release); "
            "per-task-type and per-category accuracy will report as 'unknown'. "
            "Pass --official-qa to restore them.",
            file=sys.stderr,
        )

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--src", required=True, type=Path, help="modelscope download --local_dir target")
    parser.add_argument("--dst", required=True, type=Path, help="Output root receiving qa.json and Videos/")
    parser.add_argument(
        "--official-qa",
        type=Path,
        default=None,
        help="Official liarliar/Daily-Omni qa.json used to restore Type / video_category / video_duration",
    )
    parser.add_argument(
        "--probe-duration",
        action="store_true",
        help="Derive video_duration (30s/60s) from the extracted MP4 when not supplied by --official-qa",
    )
    parser.add_argument("--batch-size", type=int, default=4, help="Parquet rows held in memory at once")
    args = parser.parse_args()

    convert(args.src, args.dst, args.official_qa, args.probe_duration, args.batch_size)

if __name__ == "__main__":
    main()

```

#### **7\.7\.2 启动服务**



在第 6 节命令基础上增加 Daily\-Omni 必需参数：`--interleave-mm-strings`（保证 image/audio 按时间交错）与 `--allowed-local-media-path`（允许 bench 以 `file://` 发送抽帧 JPEG / 分段 WAV）。



```Shell
export VLLM_WORKER_MULTIPROC_METHOD=spawn
export DAILY_OMNI_VIDEOS=/workspace/Daily-Omni/Videos

vllm serve /workspace/shared_assets/models/OpenBMB/MiniCPM-o-4_5 --omni \
    --served-model-name openbmb/MiniCPM-o-4_5 \
    --trust-remote-code \
    --deploy-config vllm_omni/deploy/minicpmo_4_5.yaml \
    --stage-init-timeout 600 \
    --host 0.0.0.0 --port 8091 \
    --allowed-local-media-path "${DAILY_OMNI_VIDEOS}" \
    --interleave-mm-strings
```



说明：



- 不需要 `--media-io-kwargs '{"video":{...}}'`：`minicpm-interleave` 模式由客户端自己按 1fps 抽帧并切分音频，发给服务端的只有 JPEG 与 WAV 分段，服务端不会解码原始视频，该参数不生效

- deploy YAML 的 `limit_mm_per_prompt` 需满足 `image >= 64`、`audio >= 64`（仓库内 `minicpmo_4_5.yaml` 已是 64/64），交错帧数上限即 64

- deploy YAML 中 thinker 采样应对齐 OmniEvalKit Daily\-Omni：`temperature: 0.0`、`repetition_penalty: 1.2`、`max_tokens: 128`（vLLM chat 无 HF `num_beams=3`，用 greedy 近似）。`repetition_penalty` 只能写在 deploy 配置里，请求体带了也会被丢掉

- 客户端抽出的帧与音频分段会缓存到 `${DAILY_OMNI_VIDEOS}/.minicpm_daily_omni_interleave/<video_id>/`，因此 `Videos/` 目录必须可写并预留额外磁盘；同时 bench 与 serve 必须在同一台机器（或共享同一文件系统），`file://` 才能被服务端读到

#### **7\.7\.3 发送评测请求**



服务就绪后执行：



```Shell
vllm bench serve \
  --omni \
  --port 8091 \
  --max-concurrency 10 \
  --dataset-name daily-omni \
  --num-prompts 1197 \
  --trust-remote-code \
  --no-oversample \
  --temperature 0 \
  --output-len 128 \
  --daily-omni-input-mode all \
  --daily-omni-pack-mode minicpm-interleave \
  --daily-omni-video-dir /workspace/Daily-Omni/Videos \
  --daily-omni-qa-json /workspace/Daily-Omni/qa.json \
  --model openbmb/MiniCPM-o-4_5 \
  --endpoint /v1/chat/completions \
  --backend openai-chat-omni \
  --percentile-metrics ttft,tpot,itl,e2el \
  --extra_body '{"modalities": ["text"], "chat_template_kwargs": {"enable_thinking": false}}'
```



说明：



- `--daily-omni-pack-mode minicpm-interleave`：按 OpenBMB 配方打包交错 image/audio（接近官方 \~80% 设置）；不要用默认 `qwen` packing 测 MiniCPM\-o

- `--daily-omni-input-mode all`：视频 \+ 独立 WAV 一起发

- `--num-prompts 1197`：`qa.json` 的全量条数；配合 `--no-oversample`，填更大的值也只会跑 1197 条

- `--percentile-metrics` 不带 `audio_ttfp` / `audio_rtf`：Daily\-Omni 只出文本（`modalities: ["text"]`），音频指标恒为空

- `--temperature 0` / `--output-len 128`：与 OmniEvalKit `do_sample=False`、`max_new_tokens=128` 对齐

- `--extra_body` 用 `"modalities": ["text"]`（Daily\-Omni 只评文本答案，不开 TTS）

- 日志末尾会打印 Daily\-Omni MCQ Overall Accuracy；也可用 `--daily-omni-save-eval-items` 把逐条对错写入结果 JSON

小流量调试可加 `--daily-omni-inline-local-video`（base64 内嵌，无需 allowlist），但全量 1197 条不建议。

#### **7\.7\.4 评测结果参考**



全量 1197 条、并发 10 的实测准确率：



```Plain Text
=========== Daily-Omni accuracy (MCQ) ============
Overall Accuracy: 937/1197 = 78.28%
Submitted (gold present):                1197
Successful HTTP (GitHub denom.):         1197
Correct:                                 937
Accuracy (ratio, same as above):         0.7828
Skipped (no gold):                       0
HTTP failed (excl. from GitHub acc.):    0
Parsed OK but no A–D found:              2
```



分维度结果：



|QA 类型|准确率|
|---|---|
|Comparative|86\.26% \(113/131\)|
|Inference|83\.77% \(129/154\)|
|Reasoning|81\.71% \(143/175\)|
|AV Event Alignment|76\.05% \(181/238\)|
|Context understanding|75\.65% \(146/193\)|
|Event Sequence|73\.53% \(225/306\)|



按视频时长：30s 78\.36% \(507/647\)、60s 78\.18% \(550 条中 430 条\)，长短视频基本持平。



判定口径：`Successful HTTP` 为分母（与 Daily\-Omni 官方仓库一致），HTTP 失败不计入。`Parsed OK but no A–D found: 2` 指模型回复里没解析出选项字母，按错误计。该结果与官方 \~80% 的报告值接近；若明显偏低，优先排查是否漏了 `--interleave-mm-strings` 或用了默认 `qwen` packing。

### **7\.8 跑 Video\-MME 数据集**



Video\-MME 用 MiniCPM 官方「仅抽帧」配方（OmniEvalKit `videomme`，w/o subs）测视频 MCQ 准确率：最多 96 帧以 `image_url` 发出，不带音轨。模型仍用 `/workspace/shared_assets/models/OpenBMB/MiniCPM-o-4_5`，服务端口 `8091`；数据默认走 Hugging Face `lmms-lab/Video-MME`，也可放到 `/workspace/Video-MME`。



#### **7\.8\.1 下载数据集**



数据来源：https://huggingface\.co/datasets/lmms\-lab/Video\-MME （需 parquet QA \+ `videos_chunked_*.zip`；可选 `subtitle.zip`）。



与 Seed\-TTS / Daily\-Omni 相同：内网走 HuggingFace 镜像站。全量视频 zip 约 **95GB\+**，请预留磁盘与下载时间。



```Shell
modelscope download --dataset lmms-lab/Video-MME \
  --local_dir /workspace/Video-MME
 
#或者直接使用共享盘下的数据集  /workspace/shared_assets/datasets/lmms-lab/Video-MME
```



能直连 HuggingFace 时去掉 `HF_ENDPOINT`。`--dataset-path` 也可直接填仓库名 `lmms-lab/Video-MME`，bench 会在首次运行时 `snapshot_download` 并自动解压视频。



本地目录确认（解压后任意一种布局均可）：



```Shell
# QA parquet（二选一）
ls /workspace/Video-MME/videomme/test-00000-of-00001.parquet \
   /workspace/Video-MME/test-00000-of-00001.parquet 2>/dev/null

# 视频：flat video/*.mp4，或未解压的 videos_chunked_*.zip / 已解压的 videos/
ls /workspace/Video-MME/videos_chunked_*.zip 2>/dev/null | head
ls /workspace/Video-MME/video /workspace/Video-MME/videos 2>/dev/null | head
```



说明：



- 全量 900 视频 / 2700 题；`--videomme-duration short|medium|long` 可只跑某一时长桶（各 900 题）

\- 官方 MiniCPM\-o 4\.5 报告 **Video\-MME（w/o subs）70\.4**；带字幕需加 \`\-\-videomme\-use\-subtitle\` 并准备 \`subtitle/\`

- ModelScope 上没有与 bench 布局一致的 Video\-MME 镜像时，同样走 HuggingFace / 镜像站

#### **7\.8\.2 启动服务**



在第 6 节命令基础上增加 \`\-\-allowed\-local\-media\-path\`（bench 默认以 \`file://\` 发送抽帧 JPEG）。\`minicpm\-frames\` 只发图像、不发交错音频，**不必**依赖 \`\-\-interleave\-mm\-strings\`（与 Daily\-Omni 不同）；若 serve 已为 Daily\-Omni 打开该开关，保留无妨。



```Shell
export VLLM_WORKER_MULTIPROC_METHOD=spawn
export VIDEOMME_ROOT=/workspace/Video-MME

vllm serve /workspace/shared_assets/models/OpenBMB/MiniCPM-o-4_5 --omni \
    --served-model-name openbmb/MiniCPM-o-4_5 \
    --trust-remote-code \
    --deploy-config vllm_omni/deploy/minicpmo_4_5.yaml \
    --stage-init-timeout 600 \
    --host 0.0.0.0 --port 8091 \
    --allowed-local-media-path "${VIDEOMME_ROOT}"
```



说明：



\- deploy YAML 的 \`limit\_mm\_per\_prompt\.image\` **必须 ≥ 96**，否则超过 64 帧的样本会 HTTP 400（\`At most N image\(s\) may be provided\`）。仓库内 \`minicpmo\_4\_5\.yaml\` 已设 \`image: 96\`（兼顾 Daily\-Omni 64 帧与 Video\-MME 96 帧）

- 客户端抽帧缓存写在视频目录下：`${VIDEOMME_ROOT}/.../.minicpm_videomme_frames/`，目录需可写并预留数十 GB；bench 与 serve 须共享同一文件系统（`file://`）

- 冷启动会对每个视频抽最多 96 帧；首次全量 2700 条前会有较长 warm\-up，属正常现象

- 不需要客户端侧 `--media-io-kwargs`：`minicpm-frames` 已在本地完成抽帧，服务端收到的是 JPEG

若视频与 Daily\-Omni 媒体不在同一父目录，把 `--allowed-local-media-path` 设为能覆盖两者的公共根（例如 `/workspace`）。



#### **7\.8\.3 发送评测请求**



服务就绪后执行（配方对齐 OmniEvalKit MiniCPM `videomme`）：



```Shell
vllm bench serve \
  --omni \
  --port 8091 \
  --max-concurrency 4 \
  --dataset-name videomme \
  --dataset-path /workspace/Video-MME \
  --num-prompts 2700 \
  --trust-remote-code \
  --no-oversample \
  --disable-shuffle \
  --temperature 0 \
  --output-len 128 \
  --videomme-pack-mode minicpm-frames \
  --videomme-max-frames 96 \
  --videomme-duration all \
  --model /workspace/shared_assets/models/OpenBMB/MiniCPM-o-4_5 \
  --endpoint /v1/chat/completions \
  --backend openai-chat-omni \
  --percentile-metrics ttft,tpot,itl,e2el \
  --extra_body '{"modalities": ["text"], "chat_template_kwargs": {"enable_thinking": false}}'
```



也可不预下载，把 `--dataset-path` 换成 `lmms-lab/Video-MME`（需能访问 HuggingFace / 镜像，且服务端 `allowed-local-media-path` 覆盖 HF 缓存目录）。



说明：



- `--videomme-pack-mode minicpm-frames`：OmniEvalKit `videomme`（`load_av=false`）；不要用默认 `video_url` 或 Daily\-Omni 的 `minicpm-interleave` 来对标官方 70\.4

- `--videomme-max-frames 96` / `--output-len 128` / `--temperature 0`：与 OmniEvalKit `max_frames`、`max_new_tokens`、`do_sample=False` 对齐

- `--num-prompts 2700`：全量题数；配合 `--no-oversample` 填更大也只会跑到数据集大小

\- \`\-\-extra\_body\` 用 \`"modalities": \["text"\]\`，且**不要**加 \`"use\_tts\_template": true\`（同 Daily\-Omni，纯文本 MCQ）

- `--percentile-metrics` 不带 `audio_ttfp` / `audio_rtf`：本配方只出文本

- 日志末尾会打印 Video\-MME Overall / by\-duration / by\-domain；可用 `--videomme-save-eval-items` 把逐条对错写入结果 JSON

- 改 `max_frames` / packing 后需清缓存：`find /workspace/Video-MME -type d -name '.minicpm_videomme_frames' -exec rm -rf {} +`

小流量调试：



```Shell
vllm bench serve ... \
  --videomme-duration short \
  --num-prompts 8
```



或加 `--videomme-inline-local-video`（base64 内嵌，无需 allowlist）；全量 2700 条不建议。



Video\-MME\-Short \+ 音轨（OmniEvalKit `videomme_short`）可改为：



```Shell
--videomme-pack-mode minicpm-interleave \
  --videomme-max-frames 64 \
  --videomme-duration short
```



此时 serve 还需 `--interleave-mm-strings`，且 `limit_mm_per_prompt.audio >= 64`。



#### **7\.8\.4 评测结果参考**



全量 2700 条、`minicpm-frames` / 96 帧 / w/o subs、并发 4 的实测：



|指标|数值|
|---|---|

\| Overall Accuracy \| **69\.96%**（1889/2700） \|

\| short \| 80\.33%（723/900） \|

\| medium \| 70\.33%（633/900） \|

\| long \| 59\.22%（533/900） \|

\| Successful HTTP \| 2700 / 2700 \|



官方 MiniCPM\-o 4\.5 报告 **70\.4**（w/o subs）；上表与之差约 0\.4pp。判定口径：\`Successful HTTP\` 为分母。若大量 HTTP 400 且报 \`At most N image\(s\)\`，优先把 deploy YAML 的 \`image\` 提到 ≥ 96 并重启 serve。

## 8\. 离线推理



仓库提供端到端离线脚本 `examples/offline_inference/minicpmo/end2end.py`，直接在进程内跑完 thinker → talker \+ Token2Wav，无需先启动服务。文本结果与 24 kHz WAV 会写入输出目录。



**说明**：离线脚本默认加载 `vllm_omni/deploy/minicpmo_4_5.yaml`，其中的 `platforms.npu` 覆盖项会在昇腾上自动生效。默认单卡布局把 thinker 与 talker\+Token2Wav 共置于 NPU 0。如需拆卡，用 `--deploy-config` 指定 2/3 卡布局，见第 6 节。



```Shell
export VLLM_WORKER_MULTIPROC_METHOD=spawn
cd examples/offline_inference/minicpmo
bash run_single_prompt.sh
```



等价命令：



```Shell
python end2end.py --query-type text --output-dir output_audio
```



多模态输入：



```Shell
python end2end.py --query-type use_image --image-path /path/to/image.jpg
python end2end.py --query-type use_audio --audio-path /path/to/audio.wav
python end2end.py --query-type use_video --video-path /path/to/video.mp4
python end2end.py --query-type use_audio --modalities text
```



支持的 `--query-type`：text、use\_image、use\_audio、use\_video、use\_multi\_audios、use\_mixed\_modalities。



多卡布局示例脚本（3 卡：thinker 2 路 TP \+ talker 独占一卡）：

```Shell
bash run_single_prompt_tp.sh
```



等价命令（将 REPO 替换为 vllm\-omni 仓库根目录）：



```Shell
python end2end.py --query-type use_audio \
    --deploy-config REPO/vllm_omni/deploy/minicpmo_4_5_3gpu.yaml \
    --stage-init-timeout 300
```

如果超时可以尝试调整stage\-init\-timeout和init\-timeout两个参数

**提示**：昇腾多进程务必先执行 `export VLLM_WORKER_MULTIPROC_METHOD=spawn`。



**提示**：提示词占位符使用 MiniCPM 风格：`(<image>./</image>)`、`(<audio>./</audio>)`、`(<video>./</video>)`。语音输出依赖助手前缀上的 `<|tts_bos|>`，脚本已自动处理。



**提示**：输出 WAV 固定为 24 kHz 单声道。



更完整离线示例：https://github\.com/vllm\-project/vllm\-omni/blob/main/examples/offline\_inference/minicpmo/README\.md



## **9\. 全双工（Full\-Duplex）实时语音部署**



第 6\~8 节是"一问一答"的半双工模式：客户端发完整请求，服务端返回完整回复。全双工模式下客户端持续上传麦克风 PCM，模型自己在约 1 秒一个的 model unit 边界上决定"继续听（listen）"还是"开口说（speak）"，因此支持说话过程中被打断（barge\-in）。



**警告**：全双工是实验特性（experimental），走 \`vllm\_omni/experimental/fullduplex\` 这条路径。不支持视频输入与音视频同步，也未做生产级的多会话容量、公平调度与故障恢复。昇腾上属于实验组合，建议先在单会话场景下验证。



### **9\.1 与半双工的差异**



- 协议：WebSocket，不是 HTTP。端点为 `/v1/realtime?duplex=1`（OpenAI Realtime 协议投影）和 `/v1/duplex`（原生会话控制协议）

- 打断判定由模型做，浏览器/客户端不跑 VAD，也不需要发 `input_audio_buffer.commit`；客户端只要每 200 ms 持续发 `input_audio_buffer.append` 即可

- 输入音频固定为 16 kHz 单声道 16\-bit PCM，输出仍为 24 kHz 单声道

- 需要一段参考音色 WAV（决定输出音色），仓库模型目录里自带 `assets/HT_ref_audio.wav`

### **9\.2 前置准备**



在完成第 1\~5 节（容器、Token2Wav 依赖、vLLM\-Omni、模型权重）之后，补装 WebSocket 客户端库：



```Shell
pip install websockets
```



准备一个输入音频转成全双工要求的 16 kHz 单声道 PCM16：



```Shell
sudo apt update && sudo apt install -y ffmpeg
ffmpeg -i input.wav -ac 1 -ar 16000 -sample_fmt s16 -c:a pcm_s16le input_16k.wav
```



**说明**：客户端会严格校验，采样率、声道数、位宽任意一项不符都会直接报错退出。



### **9\.3 启动全双工服务**



全双工用专门的部署配置 `vllm_omni/deploy/minicpmo_4_5_duplex.yaml`：



```Shell
export VLLM_WORKER_MULTIPROC_METHOD=spawn

vllm serve /workspace/shared_assets/models/OpenBMB/MiniCPM-o-4_5 --omni \
    --served-model-name openbmb/MiniCPM-o-4_5 \
    --trust-remote-code \
    --deploy-config vllm_omni/deploy/minicpmo_4_5_duplex.yaml \
    --stage-init-timeout 600 \
    --host 0.0.0.0 --port 8091 2>&1 | tee vllm_server.log
```



**说明**：全双工路由只在部署配置里显式写了 \`session\_mode: duplex\` 时才注册。用第 6 节的 \`minicpmo\_4\_5\.yaml\` 启动的服务不会有 \`/v1/duplex\` 端点，连 WebSocket 会直接失败。



该配置的关键项：



```YAML
base_config: minicpmo_4_5.yaml
pipeline: minicpmo_4_5
session_mode: duplex
active_stream_window: 1
duplex_session:
  idle_ttl_s: 300              # 会话空闲多久后回收
  disconnect_grace_s: 30       # 断线后允许重连恢复的宽限期
  resume_replay_ttl_s: 60      # 重连后可重放的事件保留时长
  max_pending_turns_per_session: 4
  max_sessions: 2              # 与下方 max_num_seqs 对齐
stages:
  - stage_id: 0
    max_num_seqs: 2
  - stage_id: 1
    max_num_seqs: 2
  - stage_id: 2
    max_num_seqs: 2
```



**提示**：\`max\_sessions\` 必须与三个 stage 的 \`max\_num\_seqs\` 对齐。默认 2 表示最多两路并发全双工会话，调大时三处要一起改。





### **9\.****4**** 确认全双工端点已注册**



服务启动后在日志里查路由表：



```Shell
grep -E "Route: /v1/(duplex|realtime)" vllm_server.log
```



正常应看到：



```Plain Text
Route: /v1/realtime, Endpoint: realtime_websocket
Route: /v1/duplex, Endpoint: duplex_websocket
```



只有 `/v1/realtime` 而没有 `/v1/duplex`，说明 `session_mode: duplex` 没生效，检查 `--deploy-config` 路径是否指向了 duplex 配置。



### **9\.****5 ****命令行 Demo 验证**



模型仓库MiniCPM\-o\-4\_5/assets下自带一些ref\_audio可以直接引用：

```Shell
python examples/online_serving/minicpmo/realtime_duplex_demo.py \
    --url 'ws://localhost:8091/v1/realtime?duplex=1' \
    --model openbmb/MiniCPM-o-4_5 \
    --input-wav input_16k.wav \ #提前准备好的16KHZ音频输入
    --ref-audio /workspace/MiniCPM-o-4_5/assets/HT_ref_audio.wav \
    --output-dir /tmp/minicpmo_realtime_duplex_demo
```



常用参数：



- `--chunk-ms`：上传分片时长，默认 200 ms，与浏览器行为一致

- `--timeout-s`：等待模型输出的超时，默认 60 秒。昇腾首次跑建议放大

- `--no-realtime-pacing`：关闭实时节奏，尽可能快地灌完音频，用于压测而非延迟测量

- `--require-audio`：要求本次必须产出音频，否则判定失败。模型选择 listen 属于正常行为，常规验证不要加这个参数

输出目录内容：



- `output.wav`：所有音频分片拼接后的 24 kHz 完整回复

- `audio_chunks/chunk_XXXX.wav`：逐个音频分片，用于看流式颗粒度

- `events.jsonl`：完整的 Realtime 事件流，排查协议问题时看这个

- `result.json`：结论与延迟指标

`result.json` 关键字段：



```JSON
{
  "ok": true,
  "model_decision": "speak",
  "audio_chunk_count": 12,
  "output_sample_rate_hz": 24000,
  "latency": {
    "ttft_ms": 320.5,
    "ttfp_ms": 480.2,
    "rtf": 0.42,
    "measurement_origin": "input_audio_buffer.commit send"
  },
  "transcript": "...",
  "errors": []
}
```



- `model_decision`：本轮模型决策，`speak` 为开口回复，`listen` 为选择继续听

- `ttft_ms` / `ttfp_ms`：首字延迟 / 首个音频包延迟

- `rtf`：生成耗时与音频时长之比，小于 1 才能实时播放

**说明**：\`model\_decision\` 为 \`listen\`、\`audio\_chunk\_count\` 为 0 并不代表部署失败。只要 \`ok\` 为 \`true\` 且 \`errors\` 为空，就说明链路是通的，只是模型认为这段输入不需要回复。换一段语义完整的语音再试。



### **9\.****6**** 浏览器实时对话**



带麦克风采集与播放的网页客户端，它自身提供页面并把同源 WebSocket 代理到后端：



```Shell
python -m examples.online_serving.minicpmo.realtime_web \
    --port 7862 \
    --ws-backend ws://127.0.0.1:8091 \
    --model openbmb/MiniCPM-o-4_5 \
    --ref-audio /workspace/MiniCPM-o-4_5/assets/HT_ref_audio.wav
```



打开 `http://<host>:7862/`，允许浏览器使用麦克风后即可开始连续对话，说话可以打断模型正在播放的回复。



若前面挂了反向代理且代理不转发 WebSocket 升级请求，把浏览器直接指向单独暴露的 Realtime 地址：



```Shell
python -m examples.online_serving.minicpmo.realtime_web \
    --port 7862 \
    --ws-backend ws://127.0.0.1:8091 \
    --ref-audio /workspace/MiniCPM-o-4_5/assets/HT_ref_audio.wav \
    --public-realtime-url wss://public.example/v1/realtime
```



**警告**：容器要额外映射 7862 端口（\`docker run\` 加 \`\-p 7862:7862\`）。另外浏览器只在 \`https\` 或 \`localhost\` 下才授予麦克风权限，远程访问需要配 HTTPS 或用 SSH 端口转发到本地。



### **9\.****7**** 自定义客户端要点**



自己实现客户端时，按下面的事件契约来：



上行（客户端 → 服务端）：



- `session.update`：设置 `input_audio_format: pcm16` 与参考音色

- `input_audio_buffer.append`：每 200 ms 一片 base64 PCM16，会话开着就一直发，模型播放期间也不要停

- `playback.ack`：回报已播放到的位置，服务端据此推进历史提交

- `session.close`：结束会话

下行（服务端 → 客户端）：



- `response.created`：一次可见回复的第一个事件

- `response.speak` / `response.listen`：模型的说/听决策。`response.listen` 可能不伴随 `response.created`，不要据此认为有回复丢失

- `response.audio.delta`：一片有序音频，每片后面必定跟一个 `response.audio_transcript.delta`

- `response.audio.done` / `response.audio_transcript.done` / `response.done`：终止事件，`response.done` 每个回复恰好一次

**提示**：不要自己在客户端做 VAD 打断。打断由模型在 model unit 边界决定，客户端强行断流反而会破坏会话状态。



**提示**：完整协议契约见 \`vllm\_omni/experimental/fullduplex/DESIGN\.md\`。

## 10\.Baseline测试

```Plain Text
env CUDA_VISIBLE_DEVICES=0 \
BENCHMARK_DIR=your_result_path/simplex_seed_tts_performance \ 
pytest -s -v \
tests/dfx/perf/scripts/run_benchmark.py \
--test-config-file tests/dfx/perf/tests/test_minicpmo_4_5.json
```

```Plain Text
env CUDA_VISIBLE_DEVICES=0 \
BENCHMARK_DIR=your_result_path/duplex_seed_tts_performance \
pytest -s -v \
tests/dfx/perf/scripts/run_benchmark.py \
--test-config-file tests/dfx/perf/tests/test_minicpmo_4_5_duplex_seed_tts.json
```

## **1****1****\. 常见问题**



**Q1：拉取镜像或 clone 超时**



原因：内网访问不了 quay\.io / github\.com。



处理：改用国内镜像与镜像站，见第 1、4 节。



**Q2：pip install 版本冲突**



原因：step\-audio2 传递依赖覆盖了镜像内的 torch / torch\_npu。



处理：step\-audio2 使用 `--no-deps` 安装。



**Q3：setuptools\_scm 报错找不到版本**



原因：从归档或镜像站拉取的代码缺少 git tag。



处理：安装时加 `SETUPTOOLS_SCM_PRETEND_VERSION=0.25.0`。



**Q4：语音输出报错 ACL stream synchronize failed, error code:507015**



原因：昇腾上 HiFiGAN 声码器的 STFT / 正弦源等算子不稳定。



处理：vLLM\-Omni 已将 NPU 上的 HiFT 声码器放到 CPU 运行。若仍复现，先设 `ASCEND_LAUNCH_BLOCKING=1` 定位真正报错的算子。



**Q5：容器内 npu\-smi info 看不到设备**



处理：检查 `--device /dev/davinciN` 与驱动目录挂载是否完整，并确认宿主机 `npu-smi info` 正常。



**Q6：多卡启动卡住或报多进程错误**



处理：确认已设置 `export VLLM_WORKER_MULTIPROC_METHOD=spawn`。



**\*\*Q7：连接 \`/v1/duplex\` 或 \`/v1/realtime?duplex=1\` 直接被拒\*\***



原因：服务不是用 duplex 部署配置启的，全双工路由没有注册。



处理：`--deploy-config` 指向 `vllm_omni/deploy/minicpmo_4_5_duplex.yaml`，并按第 9\.5 节确认日志里有 `Route: /v1/duplex`。



**Q8：demo 报 input WAV must be 16 kHz / must be mono / must be 16\-bit PCM**



原因：全双工输入格式是硬性校验，只收 16 kHz 单声道 PCM16。



处理：用第 9\.2 节的 ffmpeg 命令转码。



**Q9：Install websockets first**



处理：`pip install websockets`。这个依赖不在镜像里，也不随 vLLM\-Omni 一起装。



**Q10：全双工跑起来了但一直不出声，\`model\_decision\` 始终是 \`listen\`**



原因：模型判断这段输入不需要回复，属于正常决策，不是故障。



处理：先看 `result.json` 的 `ok` 与 `errors` 判断链路是否正常，再换一段语义完整、无长静音的语音重试。确认链路通了之后再加 `--require-audio` 做严格校验。



**Q11：报 MiniCPM\-o Talker prefill span exceeds condition，stage 1 进程退出**



原因：全双工路径下 talker 的 prefill 长度与 TTS 条件长度对不齐，属实验特性的已知问题。



处理：该 stage 进程一旦死掉，会话会被 orchestrator 关闭，服务需要重启。先降低并发（`max_sessions` 与各 stage 的 `max_num_seqs` 保持为 1），并留存 `events.jsonl` 与服务日志反馈到上游。



**Q12：全双工首包延迟明显偏高**



原因：昇腾上 HiFT 声码器跑在 CPU（见 Q4），叠加单卡三 stage 抢占。



处理：改用第 9\.4 节的双卡布局，让 thinker 独占一张 NPU；同时确认 `platforms.npu` 覆盖项生效（stage 0/1 的图模式为 `PIECEWISE`）。





