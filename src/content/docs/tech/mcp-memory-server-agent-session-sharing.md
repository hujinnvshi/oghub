---
title: 跨 Agent 会话共享：自建 MCP-Memory-Server + PostgreSQL + Git 归档方案（含评审细化）
description: 面向多主机、多 Agent（HermesAgent / Claude Code / OpenCode / DeepSeek-Harness）的会话共享与迁移方案：中立标准消息 Schema 双向转换、MCP + REST 双通道接入、PostgreSQL 运行时存储、Git 只做归档快照。附完整评审：15 处瑕疵与对策、消息 Schema 样例、MCP 工具定义、核心建表 SQL。
pubDate: 2026-08-18
---

做多 Agent 协作时，最头疼的是**会话孤岛**：HermesAgent、Claude Code、OpenCode、DeepSeek-Harness 各有一套私有会话格式，跨 Agent 接力只能靠人肉复制粘贴交接文档，既丢工具轨迹又丢思考过程，多主机之间更是完全不通。本文给出一套**自建 MCP-Memory-Server + PostgreSQL（PGVector）+ Git 归档钩子**的完整方案，并对方案做了逐条评审——15 处瑕疵、对应对策，以及细化后的消息 Schema、MCP 工具集与建表 SQL。

> 前提声明：本方案假设你**愿意编写数据转换/适配胶水层**（Agent 内部模型 ↔ 中立 Schema 双向转换、钩子/导出/快照逻辑），并接受"Agent 私有运行栈、内部 plan 不做跨框架迁移，只迁移可序列化的会话、tool trace、思考记录、项目元数据"。在这个前提下，方案才是最优解。

文中所有主机地址、端口、路径均以占位符表示（如 `<内网主机>`、`<部署目录>`），示例密钥一律使用 `<...>` 占位，不包含真实敏感信息。

---

## 一、问题与边界：先明确"解决什么、不解决什么"

### 1.1 要解决的问题

- **会话可迁移**：任一 Agent 的会话（含工具轨迹、思考记录）能完整导出、能被其他 Agent 导入继续；
- **多主机实时共享**：主机 A 追加消息，主机 B 立刻读到（Windows / Linux 通吃）；
- **版本可控**：可回滚到历史快照、可 diff、可人工审阅、可灾难恢复；
- **数据自主可控**：不依赖第三方私有记忆模型（不做 LLM 摘要改写、不绑定私有 schema）。

### 1.2 明确不解决的问题（边界）

| 不做 | 原因 |
|---|---|
| 迁移 Agent 内部 task plan / 执行栈 / 局部变量 / 私有缓存 | 各框架运行态不可序列化；由下游 Agent 依据会话历史重新推导 |
| 自动结构化 JSON merge | 结构化冲突合并是巨坑；分支用"复制快照新建 session"实现 |
| 让所有 Agent 共用一套内部格式 | 各 Agent 私有格式是生态现状，用适配器双向转换解决 |

---

## 二、方案评估：六方案对比（附评审修正）

| 方案 | 是否需要写转换层 | 核心优势 | 剩余不可消除妥协 | 推荐度 |
|---|---|---|---|---|
| **自建 MCP-Memory-Server + PG + Git 导出钩子** | ✅ 需要 | 完全中立 Schema；多主机多系统；MCP 统一接入；实时读写；向量检索一体；快照可控；Git 只做 diff 归档 | 不迁移 Agent 私有内存状态；不做 JSON merge，分支用复制新 session | ⭐⭐⭐⭐⭐ 首选 |
| LangGraph Studio Backend + 外包 MCP 网关 | ✅ 需要 | 底层 PG 成熟，自带 checkpoint / webui，省掉从零写存储逻辑 | 底层仍是 LangGraph checkpoint 模型，需映射；**checkpoint 本质是图状态快照，与"只迁移会话"的前提有张力**；仍需外挂 Git 做 diff | ⭐⭐⭐⭐ 备选 |
| MemPalace 中心化 MCP 部署 | ✅ 需要 | 开箱 MCP，完整保留原始消息 | 内部私有存储模型，schema 不由你掌控；多实例同步需改造 | ⭐⭐⭐ 原型优先 |
| NATS + PG + MinIO 分布式总线 | ✅ 大量代码 | 事件驱动，适合多 Agent 互相触发 | 组件太重；场景是会话共享而非大规模事件交互，过度设计 | ⭐ 后期扩展再叠加 |
| Mem0 / TencentDB-Agent-Memory | ✅ 需要 | 开箱即用 MCP 服务 | 私有 schema；Mem0 会用 LLM 摘要改写原始消息；版本能力弱 | ⭐ 仅做辅助记忆 |
| 纯 Git 文件方案 | ✅ 需要 | 版本能力强 | 非实时，只能接力，不能多主机并发读写 | ⭐ 仅做原型验证 |

> **评审修正**：LangGraph 备选虽然省 DB 开发，但它的 checkpoint 恰恰存储"图执行状态"——这正是本方案前提里明确不迁移的东西。如果你不是以 LangGraph 为核心框架构建 Agent，选它等于绕路。备选仅推荐给"Agent 本来就跑在 LangGraph 上"的场景。

---

## 三、总体架构：四层职责，严格分离

```
┌──────────────────────────────────────────────────────────────┐
│  Agent 适配层（双向转换器）                                    │
│  HermesAgent ⇄ 标准消息    Claude Code（原生 MCP Client）       │
│  OpenCode ⇄ 标准消息       DeepSeek-Harness（HTTP REST）       │
└───────────────┬───────────────────────────────┬──────────────┘
                │ MCP (JSON-RPC)                 │ HTTP REST
┌───────────────▼───────────────────────────────▼──────────────┐
│  接入层：MCP-Memory-Server（同核心、双 transport）            │
│  create_session / append_message / read_session /             │
│  create_snapshot / list_snapshots / load_snapshot / 管理操作  │
└───────────────┬──────────────────────────────────────────────┘
                │ SQL
┌───────────────▼──────────────────────────────────────────────┐
│  存储层：PostgreSQL（sessions / messages / snapshots /        │
│  export_jobs）· 单调 seq 水位 · 幂等键 · 逻辑快照             │
│  （阶段 4 可加 PGVector 异步派生向量）                        │
└───────────────┬──────────────────────────────────────────────┘
                │ 异步导出任务（快照成功后触发，失败重试）
┌───────────────▼──────────────────────────────────────────────┐
│  归档层：Git 仓库（append-only jsonl + tag 即快照）           │
│  私有远端（Gitea / GitHub）· 单一写者（server 侧）            │
│  只做归档、diff、人工审阅、灾难备份——不参与运行时路径        │
└──────────────────────────────────────────────────────────────┘
```

关键设计点：

1. **核心服务单实现，双 transport**：MCP 与 REST 只是协议适配层，业务逻辑（seq 分配、幂等、快照）只有一份，避免维护两套语义；
2. **Git 不参与运行时路径**：业务读写永远走 PG；Git 只在快照导出后异步归档；
3. **快照 = 逻辑指针**：`snapshots` 表只记 `(session_id, up_to_seq, commit_msg)`，不复制消息本体——物化（导出 jsonl）由异步任务完成；
4. **分支 = fork**：`load_snapshot` 从快照派生**新 session**（记录 `parent_snapshot_id` 谱系），绝不原地覆盖，规避 JSON merge。

---

## 四、中立标准消息 Schema（核心契约）

### 4.1 设计原则

- **OpenAI 兼容为基底**：`role ∈ system|user|assistant|tool`，`tool_calls` / `tool_call_id` 配对沿用 OpenAI 语义；
- **追加扩展**：`thinking`（可空、可加密不可读）、`metadata`（project、agent_source）、`schema_version`（版本演进）；
- **不可变 append-only**：消息写入后不修改，序号由服务端分配（见第六节）。

### 4.2 消息样例（assistant 消息含 tool_calls + thinking）

```json
{
  "schema_version": 1,
  "session_id": "ses_<uuid>",
  "seq": 1024,
  "role": "assistant",
  "content": "我先读取配置文件再继续。",
  "tool_calls": [
    {
      "id": "call_<uuid>",
      "type": "function",
      "function": {
        "name": "read_file",
        "arguments": "{\"path\": \"<文件路径>\"}"
      }
    }
  ],
  "thinking": {
    "content": "……（推理过程，可能为密文或空）",
    "encrypted": false
  },
  "created_at": "2026-08-18T07:00:00Z",
  "metadata": {
    "project": "<项目名>",
    "agent_source": "hermes",
    "model": "<模型名>"
  }
}
```

### 4.3 工具返回消息（tool 消息，用 tool_call_id 配对）

```json
{
  "schema_version": 1,
  "session_id": "ses_<uuid>",
  "seq": 1025,
  "role": "tool",
  "tool_call_id": "call_<uuid>",
  "content": "……工具输出（已脱敏）……",
  "created_at": "2026-08-18T07:00:01Z",
  "metadata": { "project": "<项目名>", "agent_source": "hermes" }
}
```

### 4.4 传递契约

| 传递 | 不传递 |
|---|---|
| role、content | Agent 内部 task plan |
| tool_calls、tool 返回（含 tool_call_id 配对） | 局部变量、运行栈 |
| thinking_content（可空、容错） | 私有缓存、会话级临时状态 |
| metadata（project、agent_source、model） | 密钥/口令（工具输出入库前需脱敏） |

---

## 五、MCP 工具集定义

### 5.1 工具清单

| 工具 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `create_session` | project_id, meta | session_id | 新建会话 |
| `append_message` | session_id, message（含 append_id） | seq | 追加标准消息，幂等 |
| `read_session` | session_id, after_seq, limit | messages[] | **游标分页**（after_seq），非 offset |
| `create_snapshot` | session_id, commit_msg | snapshot_id | 仅落 PG 逻辑快照，导出异步进行 |
| `list_snapshots` | session_id | snapshots[] | 快照列表 |
| `load_snapshot` | snapshot_id | 新 session_id | **fork 派生**新会话（记录 parent） |
| `list_sessions` | project_id | sessions[] | 管理操作 |
| `update_session_meta` | session_id, meta | ok | 管理操作 |
| `search_messages` | query, project_id, limit | matches[] | 阶段 4：PGVector 语义检索 |

### 5.2 JSON-RPC 示例（MCP 调用 append_message）

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "append_message",
    "arguments": {
      "session_id": "ses_<uuid>",
      "message": {
        "append_id": "msg_<uuid>",
        "role": "user",
        "content": "继续上一个任务。"
      }
    }
  },
  "id": 1
}
```

### 5.3 REST 等价接口（供 DeepSeek-Harness 等无 MCP 的客户端）

```
POST /v1/sessions/<session_id>/messages     # append_message，Authorization: Bearer <server-token>
GET  /v1/sessions/<session_id>?after_seq=…  # read_session 游标分页
POST /v1/snapshots                          # create_snapshot
GET  /v1/snapshots/<snapshot_id>/fork       # load_snapshot → 新 session
```

> **评审修正**：原方案未提鉴权。多主机网络服务从阶段 2 起就必须有**最简 token 鉴权**（或绑定内网网卡），否则任何能访问端口的主机都可读写会话。

---

## 六、PostgreSQL 存储设计（核心建表 SQL）

```sql
-- 会话表
CREATE TABLE sessions (
  id            BIGSERIAL PRIMARY KEY,
  session_id    TEXT NOT NULL UNIQUE,        -- 对外 ID，如 ses_<uuid>
  project_id    TEXT NOT NULL,
  meta          JSONB NOT NULL DEFAULT '{}', -- 标题、agent_source、parent_snapshot_id
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 消息表（append-only，全局单调 seq 即水位）
CREATE TABLE messages (
  id            BIGSERIAL PRIMARY KEY,       -- 全局单调 seq
  session_id    TEXT NOT NULL REFERENCES sessions(session_id),
  append_id     TEXT NOT NULL,               -- 客户端幂等键
  role          TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  payload       JSONB NOT NULL,              -- 中立标准消息体（见第四节）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, append_id)             -- 幂等：同键只写一次，防重试重复
);
CREATE INDEX idx_messages_session_seq ON messages (session_id, id);

-- 快照表（逻辑指针，不复制消息）
CREATE TABLE snapshots (
  id            BIGSERIAL PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(session_id),
  up_to_seq     BIGINT NOT NULL,             -- 快照截止水位
  commit_msg    TEXT NOT NULL DEFAULT '',
  meta          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 导出任务表（异步归档到 Git，失败可重试）
CREATE TABLE export_jobs (
  id            BIGSERIAL PRIMARY KEY,
  snapshot_id   BIGINT NOT NULL REFERENCES snapshots(id),
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|running|done|failed
  retry_count   INT NOT NULL DEFAULT 0,
  last_error    TEXT,
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**评审修正的落库体现**：

1. **seq 由服务端分配**（`BIGSERIAL` 全局自增）：多主机并发追加时排序以服务端为准，不信任客户端时钟；
2. **append_id 幂等键 + 唯一约束**：网络重试不会产生重复消息；
3. **快照只存逻辑指针**：`up_to_seq` 水位 + 元数据，不复制 JSONB，DB 不膨胀；
4. **read 用 after_seq 游标**：并发追加下 offset 分页会漂移，游标分页才稳定（对应 4.2/5.1 的修改）。

---

## 七、Git 归档钩子：异步、追加式、tag 即快照

### 7.1 归档流程

1. `create_snapshot` 成功 → 插入 `snapshots` + `export_jobs(status=pending)`；
2. 后台 worker 消费 `export_jobs`：读取 `session_id` 上 `seq ≤ up_to_seq` 的消息，**追加写入** `sessions/<session_id>.jsonl`（append-only，不覆盖历史行）；
3. `git add + git commit -m "snapshot <id>: <session_id> up to seq <n>"`；
4. `git tag snapshot-<id>`，`git push` 到私有远端（Gitea / GitHub）；
5. 失败 → `retry_count++`，重试（可配指数退避）；连续失败保持 `failed` 状态供巡检。

### 7.2 为什么这样设计（评审修正）

| 原方案问题 | 修正 |
|---|---|
| 快照成功后**同步**调用 git push，网络慢/失败会拖垮运行时 | 导出完全**异步**：PG 快照与 git 归档解耦，失败不污染主链路 |
| 每次导出"全部会话"全量 jsonl，git 仓库线性膨胀、diff 无意义 | **append-only 追加新消息** + **tag 标记快照**，git diff 天然是消息级增量 |
| 未指定 git 仓库写者，多主机各自 push 会冲突 | **单一写者**（server 侧 worker），Agent 主机只读写 PG |
| 快照与导出的一致性问题未谈 | 导出按 `up_to_seq` 水位在事务内读取，保证快照点是完整一致视图 |

### 7.3 Git 仓库布局

```
<mcp-memory-archive>/
├── sessions/
│   └── ses_<uuid>.jsonl        # append-only：每条消息一行
├── README.md                   # 归档说明、恢复指引
└── .git/                       # 单一写者
```

> 归档仓库与业务服务分离部署：业务故障不影响归档可读性；归档损坏不影响业务（PG 是运行时真相源，Git 是历史/审阅副本）。

---

## 八、Agent 适配层：双向转换约定

每个 Agent 实现一对转换器：

- **导出**：内部对象 → 标准消息 → `append_message`；
- **导入**：`read_session` 标准消息 → 内部对象（续跑/接力）。

| 标准字段 | HermesAgent | Claude Code | OpenCode | DeepSeek-Harness | 备注 |
|---|---|---|---|---|---|
| role | 内部角色映射 | role | 内部角色映射 | role | system/user/assistant/tool |
| content | 文本块映射 | content blocks（需降级为文本或保留结构） | 文本映射 | content | 非文本块需约定降级策略 |
| tool_calls | 内部函数调用映射 | tool_use block | 工具调用映射 | tool_calls | 需稳定 tool_call_id |
| tool 返回 | 内部结果映射 | tool_result block | 结果映射 | tool 消息 | 用 tool_call_id 配对 |
| thinking | 推理记录导出 | **加密 thinking 默认不可读** | 部分支持 | reasoning_content | 可空、容错，不承诺可读 |
| metadata | 项目/来源字段 | 无原生，由包装层补 | 自定义字段 | 自定义 | project / agent_source 必备 |

**评审修正**：

- **丢字段告警**：导入时对无法映射的字段输出警告/映射报告，作为阶段 1 验收项（不做静默丢弃）；
- **thinking 容错**：Claude 的加密 thinking、部分模型无 reasoning，标准消息中 `thinking` 必须可空；
- **脱敏红线**：工具输入/输出可能含密钥，入库前经脱敏过滤器（grep 密钥模式 + 白名单）——与本博客发布门控同理。

---

## 九、评审发现的 15 处瑕疵与对策（全文核心）

| # | 瑕疵 | 对策 |
|---|---|---|
| 1 | `create_snapshot` 成功后同步调用 git push，网络失败拖垮运行时 | 拆分为 PG 逻辑快照 + 异步导出任务（`export_jobs`，可重试） |
| 2 | 快照存储模型未定义；全量 JSONB 复制会令 DB 膨胀 | 快照 = 逻辑指针（session_id + 水位 seq + 元数据） |
| 3 | 每次导出全量 jsonl → git 仓库线性膨胀、diff 无意义 | append-only 追加 + `git tag` 即快照 |
| 4 | 多主机并发追加：排序与幂等未处理 | 服务端单调 seq（BIGSERIAL）+ 客户端 `append_id` 幂等键 |
| 5 | `read_session(offset, limit)` 在并发追加下游标漂移 | 改用 `after_seq` 游标分页 |
| 6 | PGVector 列为标配但阶段 4 才用，embedding 来源未定 | 向量检索为派生能力，异步生成，不阻塞主链路 |
| 7 | "MCP 统一接入"与 DSH 走 HTTP 矛盾，恐维护双份逻辑 | 核心服务单实现，MCP/REST 仅协议适配 |
| 8 | 多主机网络服务无鉴权 | 阶段 2 起加最简 token 鉴权 / 绑定内网 |
| 9 | `load_snapshot` 语义模糊（覆盖 vs 分支） | 一律 fork 新 session，记录 parent_snapshot_id |
| 10 | 转换层丢字段静默 | 丢字段告警 + 映射报告，阶段 1 验收项 |
| 11 | thinking 可能加密/不可读 | schema 中 thinking 可空 + 容错 |
| 12 | "本地 git 二进制"未指定主机，多主机各自 push 冲突 | git 归档单一写者（server 侧） |
| 13 | 中立 schema 无版本号，演进困难 | 消息带 `schema_version`，转换器按版本适配 |
| 14 | LangGraph 备选与"不迁移内部状态"前提有张力 | 仅推荐给以 LangGraph 为核心框架的场景 |
| 15 | MCP 工具集缺管理操作 | 补 `list_sessions`、`update_session_meta`、`search_messages` |

---

## 十、分阶段落地路线（避免一次性铺大摊子）

### 阶段 1：标准 Schema + Agent 双向转换器（先跑通接力）

1. 定义 json schema（含 `schema_version`）；
2. HermesAgent 导出会话 → 标准 json；标准 json 导入 DeepSeek-Harness；
3. 本地 Git 做快照，跑通接力，**记录丢字段**并打磨转换逻辑；
4. 验收：字段映射报告无静默丢失。

> 这一步完成即解决异构 Agent 互通的核心问题，甚至不需要数据库。

### 阶段 2：最小 MCP-Memory-Server + PostgreSQL

- 只实现核心接口：session 增删、append_message、read_session（after_seq）、create_snapshot、load_snapshot（fork）；
- 接入 Claude Code / HermesAgent（MCP）；**启用 token 鉴权**；
- 验收：双主机并发追加无重复、游标分页稳定。

### 阶段 3：异步 Git 归档钩子 + DeepSeek-Harness HTTP

- `export_jobs` worker + append-only jsonl + tag 推送；
- DSH 走 REST 双向转换；
- 验收：快照后归档自动完成，git diff 可读，失败可重试。

### 阶段 4（可选）：PGVector 检索、权限、限流

- 消息 → 异步 embedding → `search_messages`；
- 按 project 的读写权限、消费限流。

---

## 十一、已知局限与边界

1. **跨框架接力不能迁移 Agent 内部运行状态**：只能迁移可序列化会话与工具记录，下游 Agent 需重建内部 plan——这是生态现状，不是架构问题；
2. **无自动结构化 merge**：分支采用复制快照新建 session，谱系可追溯但合并靠人工；
3. **thinking 不承诺可读**：加密 thinking（如 Claude 默认行为）以密文或空值保存；
4. **Git 归档是异步副本**：极端情况下最新几条消息可能尚未归档（PG 永远是真相源）。

---

## 总结

在"愿意写转换层"的前提下，**自建 MCP-Memory-Server + PostgreSQL（标准消息 schema + PGVector）+ 快照导出 Git 归档钩子**是综合最接近完美的方案：

- **PG** 负责运行时实时多主机读写（单调 seq + 幂等键 + 逻辑快照）；
- **MCP + REST 双 transport** 统一接入各 Agent，核心逻辑单实现；
- **Git 只做归档、diff、审阅、备份**，异步执行、单一写者，不介入业务路径；
- **分支 = 复制快照新建 session**，避开 JSON 合并这个巨坑。

评审环节把"快照同步导出、全量 jsonl 膨胀、并发排序、鉴权缺失、load_snapshot 语义、丢字段静默"等 15 处问题逐一修正——方案的价值不在选型本身，而在这些细节的闭环。
