---
title: DSH 技能化实践：把博客发布流程做成可复用技能（blog-publish）
description: 从一次博客连续三次构建失败的排障出发，把"文章发布流程 + 格式校验 + 质量门控"固化为 DSH 标准技能 blog-publish：SKILL.md 指令 + check-article.ps1 门控脚本 + 多技能部署脚本，实现多会话、多工作区即用。本文由该技能自身发布（dogfooding）。
pubDate: 2026-08-18
---

用 DSH（DeepSeek Harness）做长线项目时，把**踩过的坑固化成可复用资产**是提升效率的关键。这篇记录我怎么把"博客文章发布流程"从一次排障经历，打磨成一个标准技能 `blog-publish`——并**用这个技能发布这篇文章本身**（dogfooding）。

文中所有主机地址、端口、路径均以占位符表示，不包含真实敏感信息。

---

## 一、起因：连续三次构建失败

某天给个人博客（Astro Starlight + GitHub Pages）推送一篇新文章，发现 GitHub Actions **连续三次部署失败**，且都是 26–35 秒的"快速失败"——这种速度说明不是依赖安装超时，而是**校验/构建早期就挂了**。

排查路径：

1. 先排除依赖问题：`package-lock.json` 与 `package.json` 一致（lockfileVersion 3），`npm ci` 不是嫌疑；
2. 再看内容校验：Astro 的内容集合（`src/content.config.ts`）使用 Starlight 的 `docsSchema`（扩展 `pubDate`）——**内容文件必须满足 schema 才能通过 `astro check`**；
3. 定位根因：最近两篇投稿文档**缺少 YAML frontmatter**（直接以 `# 标题` 开头），schema 校验失败 → `astro check` 失败 → 构建失败。

> 教训：**"缺 frontmatter"这类格式问题，会成为发布流程里最隐蔽的暗坑**——内容人写的时候完全无感，CI 却直接红掉。

修复也很简单：给两篇文档补上 `title` / `description` / `pubDate` 三字段（与全站既有文档一致），重新推送即通过。

## 二、需求：把流程固化成技能

排障之后，一个更本质的问题浮现：**这套发布流程（格式规范 → 校验 → 质量门控 → 推送 → 部署确认）每次都要人肉执行**，而且校验点散落在经验里。于是需求明确：

- **多会话可用**：任何新会话都能一键调用完整流程；
- **多工作区可用**：不依赖某个固定目录，仓库位置按规则定位；
- **质量门控自动化**：格式/脱敏/全站一致性检查用脚本执行，而不是靠"记得检查"。

依托此前搭建的 DSH 共享记忆体系（四层记忆模型，见 [上一篇](./dsh-shared-memory)），技能天然属于 **L2 按需手册**：源码放在记忆仓库 `dsh-memory`，经部署脚本同步到 `~/.dsh/skills/`，任何会话的技能目录自动收录。

## 三、设计：指令 + 脚本 + 部署

### 3.1 技能构成

```
skills/blog-publish/
├── SKILL.md                      # 指令：流程、格式规范、门控清单、故障排查
└── scripts/
    └── check-article.ps1         # 质量门控脚本（单篇 + 全站）
```

`SKILL.md` 用 frontmatter 声明 `name`（kebab-case）与 `description`，DSH 技能目录据此自动收录；正文覆盖：总体流程、仓库定位规则、**文章格式规范**（frontmatter 三字段、正文无重复 H1、中文编号章节、脱敏占位符、UTF-8）、**质量门控清单**、发布操作、部署确认与已知故障排查。

### 3.2 质量门控脚本

`check-article.ps1`（PowerShell，兼容 PS 5.1）支持两种模式：

```powershell
# 单篇校验：frontmatter / 正文无重复 H1 / UTF-8 / 敏感信息零命中
check-article.ps1 -Path <文章.md>
# 全站校验：src/content/docs/ 下所有文档首行必须为 ---（防构建失败回归）
check-article.ps1 -All <仓库根>
# 可选：扩展敏感模式
check-article.ps1 -Path <文章.md> -SensitivePatterns <模式1>,<模式2>
```

- 单篇模式逐项输出 `[PASS]`/`[FAIL]`，退出码 0/1；
- 敏感信息默认模式覆盖私钥、AWS/GitHub/OpenAI 等 token 特征，可扩展；
- 全站模式把"缺 frontmatter"这类**构建级事故**挡在提交之前。

### 3.3 部署脚本改造

记忆仓库的 `install.ps1` 原本只处理单个技能（写死 `zentao-dev`），改造为**遍历 `skills/` 下所有技能同步**到 `~/.dsh/skills/`（目录 junction 优先、复制回退、幂等），新增技能零改动即自动部署：

```powershell
Get-ChildItem -Path $repo\skills -Directory | ForEach-Object {
  # junction 优先，失败回退复制；已存在则识别链接类型并跳过/刷新
}
```

## 四、实施与检查确认

部署后立即验证（结果均为通过）：

| 检查项 | 结果 |
|---|---|
| 技能目录收录 `blog-publish` | ✅ 部署后会话技能目录即时更新 |
| `skill blog-publish` 加载 | ✅ 从 `~/.dsh/skills/blog-publish` 正常渲染 |
| 门控-好样本（本篇前作） | ✅ 8 项全 PASS，退出码 0 |
| 门控-坏样本（缺 frontmatter） | ✅ 正确拦截，退出码 1 |
| 全站校验（全仓库文档） | ✅ 所有文档均有 frontmatter |
| 部署幂等 | ✅ 二次运行识别已链接，无重复副作用 |

坏样本拦截是关键：**质量门控的意义就是让"构建失败"提前到"提交之前"**——错误越早被发现，修复成本越低。

## 五、效果与复用

- **新会话即用**：技能目录自动收录，任务匹配或显式 `skill blog-publish` 均可加载；
- **多工作区通用**：不依赖固定 cwd——仓库位置按"显式路径 → git 根探测 → 克隆"规则定位，脚本接收显式参数；
- **与共享记忆联动**：`~/.dsh/AGENTS.md` 常驻指针里登记了"发布博客文章：skill blog-publish"，任何会话开局即知有此技能；
- **版本可控**：技能源码在 `dsh-memory` 仓库（git），变更 → 重跑 install.ps1 → 全局生效；
- **本文即由该技能发布**：撰写 → 门控 → 推送 → 部署确认，全流程一次跑通。

## 六、总结

这次实践沉淀出三个可复用的方法论：

1. **把"踩坑经验"固化为"可执行门控"**：光记经验（"记得写 frontmatter"）不够，要让脚本在提交前强制校验（"检查所有文档首行是 ---"）；
2. **技能 = 指令 + 脚本 + 版本控制**：`SKILL.md` 给 Agent 行为准则，`scripts/` 给可执行校验，仓库给变更历史——三者缺一不可；
3. **质量门控前置**：CI 是最后一道防线，技能把同一套校验前移到"写作-发布"环节，让错误在源头被拦截。

如果你也在用 DSH 维护内容/代码仓库，强烈建议把重复的发布流程做一次"技能化"——一次投入，长期复用。
