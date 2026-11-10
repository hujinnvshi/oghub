---
title: 审查规则配置的版本控制与 MFA：让安全策略可审计、可回滚
description: 红线条款与审查提示词的 git 版本链设计，以及为什么策略变更要加一道动态码二次校验。
pubDate: 2026-09-03
---

> 评审对象：全量扫描页「审查规则配置」卡的版本控制功能（d5e33e9，git+diff2html 方案）
> 走查范围：`prompt_git.py`（110 行全文）、`ai_code_scan_server.py` L2139-2213（5 路由）、`db_dao.py` L3717-3785、`templates/full_scan.html` L624-824、`database.py` 表结构、`service.sh`（单进程确认）
> 性质：阶段 1-2（需求评审+方案评审），本文为评审产物，实施待确认

## 一、总体结论

**架构方向正确，核心语义成立**：DB 真源 + git 版本链的双写设计解决了原 history 表「首保存无版本」的语义缺陷；每 key 一文件、`--root` diff、hash regex 校验、git 失败仅告警不阻断、回滚=保存留痕，这些决策都合理。单进程部署（service.sh）下 threading.Lock 串行化足够。

发现 **3 个功能级问题（建议修）**、**4 项设计债（可选）**、**3 项低风险提示**。

## 二、功能级问题（建议修）

### P1 跨 tab 索引错位：`_tab` 字段已存未用 ⚠️ 最值得修
- 位置：`full_scan.html` `viewPromptDiff(idx)` / `rollbackPrompt(idx)`
- 现状：历史条目存了 `_tab` 标记（L769），但两个函数取 API 都用 `currentApi()`（当前 tab）。切换 tab 后 `loadPromptHistory()` 异步重新 fetch，**竞态窗口内**点旧 tab 的条目：`items[idx]` 是旧 tab 的 hash，请求却打到新 tab 的 API。
- 后果：diff 恒空（另一仓库无此 hash，显示「无差异记录」误导）；**回滚更糟——会把 A tab 的内容 POST 到 B tab 的保存接口**（红线内容写进 review_system_prompt，或反之，格式校验可能拦不住：红线内容若恰好含 "- " 行就通过红线校验，反之 JSON 校验大概率拦住）。
- 修法（一行级）：两个函数改用 `PROMPT_TABS[item._tab].api`，`_tab` 缺省回退 `currentApi()`。

### P2 「恢复内置默认」不在 git 版本链留痕
- 位置：`api_reset_scan_red_lines` → `delete_scan_prompt_config` 只写 DB history 表；UI 已完全不读该表。
- 后果：reset 后版本链看不出发生过重置；下一次保存的 diff 直接基于重置前的自定义内容，链上无「回到默认」事件节点。`resetTip` 文案承诺「历史留痕」但 git 链上实际无痕。
- 修法：reset 也走一次 `prompt_git.save_version`（内容=内置默认，message=`恢复内置默认`），DB 删行不变；这样版本链完整呈现 自定义→默认→… 的真实轨迹。

### P3 git commit 在 DB upsert 之前，失败顺序产生「幻影版本」
- 位置：`db_dao.save_scan_prompt_config` L3733-3738（git 先）→ L3739-（DB 后）。
- 后果：git 提交成功但 DB 写失败（连接抖动）时，版本链多出一个**从未生效**的版本；回滚到它反而会恢复一个从未真正生效过的内容。
- 修法：调序——DB 成功后再 git 提交（失败仅告警，语义与现状一致但幻影方向变为「漏版本」而非「假版本」，漏版本危害更小）。附带 return 值带 git hash 供前端展示可选。

## 三、设计债（可选，按需决策）

| # | 项 | 说明 | 建议 |
|---|---|------|------|
| D1 | 双历史冗余矛盾 | d5e33e9 提交信息说「history 表停止使用」，但 save/delete 仍写 `scan_prompt_config_history`；注释与代码矛盾 | 二选一：删写入（简化）或保留作 DB 侧灾备并改注释说明 |
| D2 | history 接口 N+1 | 每个版本单独 `git show` 取全文，20 版本=21 个子进程调用 | 一次性 `git log -p --format=...` 解析；量级小（~10ms/次）可不做 |
| D3 | 版本无真实身份 | author/updated_by 恒为 config-panel，无认证体系下的已知局限 | 记录来源 IP 进 message 可低成本增强（request.remote_addr 传入） |
| D4 | 乐观锁分钟精度 | `updated_at` 格式化到分钟，同分钟内二次保存不触发 409 | 轻量设计已知，可在 UI 提示或改比对秒级原文 |

## 四、低风险提示（记录即可，不建议动）

1. `prompt_git.get_content_at/get_diff` 的 ref 未做格式校验——当前调用源安全（diff 端点有 `[0-9a-f]{7,40}` regex，history 用 git log 产出的 hash），防御性加 regex 属纵深加固
2. `ensure_repo` 在读路径无锁调用，首访问高并发极小概率撞 `.git` 初始化；可挪进 `_lock` 统一
3. nothing-to-commit 判定匹配英文 stdout 文案，git 版本/locale 变化可能失效；更稳做法是先 `rev-parse HEAD` 比对或 `--dry-run`

## 五、做得好的点（保留不动）

- 每 key 一文件 + `git log -- <file>` 过滤：两配置版本链天然隔离，commit 互不污染
- 首版本 `--root` 全量新增 diff + hash regex 400 校验
- git 失败仅告警不阻断保存（可用性优先，与 DB 真源定位一致）
- 回滚=以历史内容保存一次自动留痕（纯追加式版本链，无历史改写）
- diff2html/marked 本地化、escapeHtml 五字符全转义、marked 输出 script/事件属性清洗兜底

## 六、建议实施范围（待用户确认）

**最小集 = P1 + P2**（前端 2 处一行修 + reset 加一次 git 提交），P3 一并做成本也低（调序）；D1 建议顺带定夺。预计一个 `fix(000)` 提交可覆盖。

## 七、实施记录（同日，用户确认仅实施 P1）

- 改动：`templates/full_scan.html` 新增 `historyApi(item)`（按 `_tab` 定位 API，无 `_tab` 回退当前 tab），`viewPromptDiff`/`rollbackPrompt` 两处调用改用之；其余 `currentApi()` 调用点（加载/保存/重置/历史列表跟随当前 tab）不变，语义正确
- 校验：内联 JS 提取 `node --check` 通过；`historyApi` 跨 tab/无 `_tab`/null 三断言 node 跑通
- 提交：内层仓 `2414459 fix(000)`（feature_mr_check）
- 未实施：P2/P3/D1-D4（用户决策保留现状），本报告留档供后续翻案
- 部署：✅ 已发布（2026-09-03 18:10）——push origin（http+token，df2cda1..2414459）→ 跳板机中转 scp → gitrunner 备份 `full_scan.html.bak-fixP1-202609031810` → 覆盖 → service.sh restart（PID 1872945）→ 线上验证：/health ok + `/full-scan-page` 页面 grep `historyApi` 3 处命中（与本地一致）；临时文件已清理

## 八、词级 diff 优化（同日，用户反馈「整行红绿不直观」）

- **根因**：diff 粒度是行，红线条款是一条一行的 90+ 字长句——改一个字也整行红+整行绿，改动点淹没
- **二次发现（关键）**：git `--word-diff` 默认按空格分词，**中文无空格整句仍被标记为一个词**（E2E 实测）；必须 `--word-diff-regex=.` 降到字符粒度，实测「示例值→示例值A」只标出 `{+A+}`
- **实现**（d90de86 feat(000)）：prompt_git 新增 `get_word_diff`（字符粒度，root 提交 fallback 为 `git show --word-diff`）；两个 diff 端点支持 `?mode=word`；前端 `viewPromptDiff` 改走词级 + `renderWordDiffHtml` 行内渲染（删除红底删除线 / 新增绿底加粗，替换 diff2html 整行红绿）
- **校验**：py_compile + node --check + 本地 git 仓 E2E（解析器对 word-diff 输出断言 1删1增）+ 线上验证（页面含新代码、`mode=word` API 返回 `{+...+}` 片段）
- ⚠️ **发布事故与教训（18:30 首次发布失败）**：多文件发布时**漏了「跳板机→gitrunner」的源文件中转跳**，deploy 脚本 cp 了 gitrunner /tmp 的历史残留旧文件，把 P1 修复也回退了（页面 grep historyApi=0 发现）。18:45 重发修正：**发布脚本必须打 md5 三段对齐（本机→暂存→落盘）+ 落盘后再校验**，本次已按此执行全部通过（PID 1875489）。此教训应进发布 runbook

## 九、同日后续迭代（时间线/按钮布局/MFA）

- **70141d4**：历史版本改竖向时间线（节点圆点+连线，最新版本绿点高亮+「当前生效」徽标；diff 框点击展开）；Playwright 离线断言通过
- **5cfe38f**：操作按钮（编辑/预览+保存+恢复默认）从顶栏移到编辑框下方成组；两 tab 共用同步生效
- **99b9f33**：修复 Push/MR 提示词保存校验误拒——issues/severity 结构由 `--json-schema` 参数另行强制（claude_review L360），不依赖提示词文本；旧校验要求文本含两字面量导致内置默认原样保存也被拒。放宽为仅校验保留 JSON 字样。线上 E2E：内置默认原文保存成功
- **7c7285f**：MFA 二次校验上线——TOTP 本地校验（RFC6238 标准向量全过），密钥存 `config.MFA_TOTP_SECRET`（git 忽略区，本机与 gitrunner 已同值配置），未配置优雅降级；覆盖保存红线/保存提示词/恢复默认（回滚走保存接口自动覆盖）；±1 时间窗，每 IP 60s 内 5 次失败锁定；前端 prompt 取码 + `/api/mfa/status` 探测。线上 E2E：无码 403/错码 403/正确码 200/限速生效
- 「华为云 APP 的 MFA」决策记录：用户确认**新绑验证器条目**（标准 TOTP，任意验证器 App 可绑），不复用华为云账号 MFA（那需走华为云 IAM API + AK/SK + 公网出口，过重）
