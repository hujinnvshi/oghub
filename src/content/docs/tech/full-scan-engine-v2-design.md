---
title: 全量扫描引擎 v2 设计：从通读代码到规则加图谱的分层审计
description: 为什么把整仓代码全塞给大模型是低效的，以及规则层、图谱层、增量层如何把 LLM 审阅量压到 5%-15% 的架构设计。
pubDate: 2026-09-04
---

> 阶段：方案评审稿（六阶段之阶段 2）｜状态：待用户评审
> 决策记录：四层全做 / 允许服务端新依赖（semgrep、tree-sitter）/ 同库双引擎兼容
> 前置阅读：本文件替代讨论稿（业界对照见会话记录）；现有引擎逻辑见 claude_scan.py 四阶段

## 一、目标与非目标

**目标**
1. LLM 实际审阅代码量从 ~100% 降到 5%-15%（候选点 + 上下游上下文）
2. 确定性规则 100% 覆盖（凭证/红线条款可规则化的部分），LLM 专注语义复核
3. 全量扫描支持文件级增量（未变更文件复用上次结论）
4. 结果与现有 issues 表/页面/指纹去重无缝互通，支持新旧引擎效果对比

**非目标**
- 不改 push/MR 增量审查链路（本方案仅全量扫描）
- 不追求跨语言完美数据流分析（taint 分析只做规则库内置能力，不自研）
- 不引入 embedding 向量库（检索层用图谱+引用关系，不走向量，减少基础设施）

## 二、总体架构

```
                     全量扫描请求（分支最新 commit 快照）
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │ M2 增量层                 ▼                          │
        │  文件内容哈希 vs 基线 ──变更集──▶ 未变更→复用上次结论  │
        │                          ▼                          │
        │ M1 规则层（确定性，秒级）                              │
        │  gitleaks（凭证）+ semgrep（红线规则化 ~15条）         │
        │  → 候选发现 candidate ─────────────┐                 │
        │                                   ▼                 │
        │ M3 图谱层（结构）                                     │
        │  tree-sitter 解析 → 符号表+调用图（缓存，按 commit 键）│
        │  → 入口点清单（路由/SQL拼接/命令执行/反序列化）        │
        │  → 每候选组装上下文：入口+2跳上下游+关联文件           │
        │                          ▼                          │
        │ M4 LLM 精审层（复用现有四阶段骨架的后半）              │
        │  规则候选复核（triage：确认/误报/升级描述）            │
        │  图谱入口语义审查（现有阶段2提示词改造，喂精准上下文）  │
        │  汇总（现有阶段4）                                     │
        └──────────────────────────┬──────────────────────────┘
                                   ▼
              结果融合：source=rule/graph/llm 标注 → 指纹去重 → issues 表
              引擎版本 engine=v2 标注于 reviews 记录，可对比可回滚
```

## 三、里程碑

### M1 规则层（预计 2 个工作会话）
- gitrunner 安装 semgrep（离线 wheel 预备方案）；验证 python3 -m semgrep 可跑
- 红线条款 → semgrep 规则映射（15 条中可规则化约 11 条：硬编码凭证/密钥、SQL 拼接、命令执行拼接、弱哈希、不安全反序列化、明文日志敏感字段、调试开关、默认口令模式、http 明文传输、路径拼接、随机数安全）
  - 不可规则化 4 条（如"日志内容要能支撑审计"）继续由 LLM 语义层覆盖
- 规则命中 → `candidates`（内存态，随 review 落库 source='rule'）→ LLM triage 单批复核
- **验收**：对现有仓库跑出规则命中，LLM 复核误报率 <30%；单仓库规则扫描 <30s

### M2 增量层（预计 1 个工作会话）
- 新表 `scan_file_baseline(review_id, file_path, content_hash)`；同 project+branch 上次成功全量为基线
- 未变更文件：跳过 LLM，上次问题沿用（指纹不变自动成立）；**规则层仍全量跑**（秒级无成本）
- 失效条件：红线/提示词版本变化（prompt 版本哈希进 review 记录）、规则集版本变化 → 自动全量
- **验收**：二次扫描同仓库，LLM 调用文件数 ≈ 变更集大小；结论与首次一致（无变更时零新增零丢失）

### M3 图谱层（预计 3 个工作会话）
- tree-sitter 语言 grammars（python/java/js/ts/go/csharp/cpp 按现有语言集）
- 解析产物缓存表 `code_graph_cache(commit_sha, language, symbols_json, edges_json)`，同 commit 复用
- 入口点识别器（每语言一组查询模式）：Web 路由 handler、SQL 拼接点、subprocess/os.system、eval/exec、反序列化、文件读写+用户输入
- 上下文组装器：入口函数 + 2 跳调用链（调用者/被调用者）+ 同文件相关片段，单候选 ≤3000 token
- 阶段2' 改造：从"平铺全文件分批"改为"入口候选逐个/小批精审"；阶段1 概览保留（喂图谱摘要）
- **验收**：抽样 5 个已知历史高危问题，图谱投放召回 ≥4/5；单仓库 LLM token 降幅 ≥70%

### M4 融合层与可观测（预计 1 个工作会话）
- findings 统一来源标注：`source ENUM('rule','graph','llm')`（issues 表加列，默认 'llm' 兼容存量）
- reviews 记录引擎版本、规则命中数、图谱入口数、LLM 实审文件数、token 用量（llm_usage 已有）
- 任务记录页展示：引擎徽标 v2、规则命中 N / LLM 精审 M、与 v1 对比 token 曲线
- 双引擎影子运行：engine 参数 `v1|v2|shadow`（shadow=两引擎都跑只记不展示，用于效果对比）切默认需数据支撑
- **验收**：同仓库 v1/v2 各跑一次，产出对比报告（问题数/重叠度/误报/token）

## 四、数据模型变更（全部向后兼容）

```sql
ALTER TABLE issues ADD COLUMN source_engine VARCHAR(8) DEFAULT 'llm';  -- rule/graph/llm
CREATE TABLE scan_file_baseline (review_id BIGINT, file_path VARCHAR(512), content_hash CHAR(64), KEY(review_id));
CREATE TABLE code_graph_cache (commit_sha CHAR(40), language VARCHAR(32), symbols_json MEDIUMTEXT, edges_json MEDIUMTEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uk_sha_lang(commit_sha, language));
```

## 五、工程规范（"要规范"的落地）

1. **模块化**：新代码独立 `engine_v2/` 包（rules/ graph/ retrieval/ fusion/ 四模块 + pipeline.py 编排），claude_scan.py 不做大改（v1 保活）
2. **单测**：每模块 pytest（规则映射表逐条用例、图谱解析样本仓库、增量失效逻辑）；现有 include_paths 单测并入回归集
3. **部署门禁**：沿用 md5 三段对齐 + import 冒烟 + 本地全模块 py_compile；semgrep 可用性探测进服务启动自检（不可用自动降级 v1 并告警）
4. **评测基准**：建 `engine_v2/benchmark/` 固定样本（历史确认问题 ≥12 个 + 误报样本），每里程碑跑回归，指标进实施记录
5. **提交规范**：每个里程碑独立 feat 提交 + 验收记录入 analysis/

## 六、风险与回滚

| 风险 | 缓解 |
|------|------|
| semgrep 离线装不上 | M1 前置验证；失败则规则层降级为自写 grep 规则引擎（已备选型），图谱层不受影响 |
| tree-sitter 某语言解析质量差 | 该语言回退"平铺+规则"模式（语言级降级矩阵） |
| v2 召回不及 v1 | shadow 模式数据对比后才切默认；engine 参数随时回 v1 |
| 图谱构建大仓慢 | 按 commit 缓存 + 语言并行解析；>5000 文件仓库分片 |

## 七、实施顺序与验收总表

M1（规则）→ M2（增量）→ M3（图谱）→ M4（融合），每步独立上线可验证、可回滚；全部完成后 shadow 对比两周数据再切默认引擎。
