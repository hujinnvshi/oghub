# 项目交接文档（PROJECT）

> 本文件是整个项目的**完整记录与交接文档**，覆盖目标、决策、过程、状态与后续。
>
> 文档分工：
> - **[README.md](./README.md)** —— 日常开发与内容更新（命令、写内容、日常流程）
> - **[DEPLOY.md](./DEPLOY.md)** —— 首次上线 runbook + 故障排查
> - **PROJECT.md（本文件）** —— 项目全貌 / 决策记录 / 验证记录 / 交接

**最后更新**：2026-08-06

---

## 1. 项目简介

基于 **Astro + Starlight** 的个人静态站点，托管文章、项目介绍与关于页，通过 **GitHub Actions** 自动部署到 **GitHub Pages**，使用自定义域名访问。

| 项 | 值 |
|---|---|
| 线上地址 | https://github.opengood.cc |
| 仓库 | `hujinnvshi/oghub`（**Public**，用于 Pages） |
| 技术栈 | Astro `7.1.6` + @astrojs/starlight `0.41.7` + sharp `0.35.3` |
| 运行时 | Node.js `22` |
| 部署 | GitHub Actions → `gh-pages` 分支 → Pages |

目标：**写 Markdown，剩下全自动**。无数据库、无服务器、无运维。

> 备注：最初建在私有仓库 `hujinnvshi/opengood-hub`，因 GitHub Free 的 Pages 只服务公开仓库，已迁移到公开仓库 `oghub`。

---

## 2. 当前状态

### ✅ 已完成（沙箱内）
- 脚手架：Astro 7 + Starlight（最新版）
- 配置：`site: 'https://github.opengood.cc'`、**不写 `base`**、侧边栏、`public/CNAME`
- 内容：首页（splash）+ 展示文章《从零搭建 Astro + Starlight 个人站点》+ 项目占位 + 关于我
- 自动部署工作流 `.github/workflows/deploy.yml`（gh-pages 方案 + `permissions: contents: write`）
- 本地构建 **0 报错**；预览全页 200、CSS/JS/图标/sitemap 200、404 正常
- 文档：README + DEPLOY + PROJECT
- 本地 git 提交完成

### ⏳ 待用户操作（上线最后一公里）
1. 确认 Actions 放行（Settings → Actions → General，默认开）。
2. 等 Actions 绿勾、`gh-pages` 分支自动生成。
3. Pages：Source = `Deploy from a branch` → 分支 `gh-pages` / `(root)`。
4. 绑定自定义域名 `github.opengood.cc` + 勾 **Enforce HTTPS**。
   - 若提示域名被占用：去旧仓库 `opengood-hub` 的 Settings → Pages 删除该自定义域名（一个域名只能被一个仓库认领），再回 `oghub` 绑定。
5. 访问 https://github.opengood.cc 逐项验证。

---

## 3. 架构与数据流

```
你写 .md ──npm run build──▶ dist/（纯静态文件）
git push main ──▶ GitHub Actions 重新 build ──▶ 把 dist 推到 gh-pages 分支
GitHub Pages 服务 gh-pages 分支 ──▶ https://github.opengood.cc
```

**分支模型**：
- `main` = 源码（人工维护）。
- `gh-pages` = Actions 自动生成的构建产物，**勿手动改**。
- `public/CNAME` 随构建进入 `dist/`，告诉 GitHub 自定义域名。

---

## 4. 目录结构与关键文件

```
oghub/
├─ astro.config.mjs              # 站点配置：site / sidebar / social
├─ package.json / package-lock.json
├─ tsconfig.json
├─ .gitignore                    # 排除 node_modules / dist / .astro
├─ public/
│  ├─ CNAME                      # ★ github.opengood.cc（勿删）
│  └─ favicon.svg
├─ src/
│  ├─ assets/                    # 图片（md 相对引用）
│  ├─ content.config.ts          # Starlight docs 内容集合
│  └─ content/docs/              # ★ 所有页面
│     ├─ index.mdx               # 首页（splash）
│     ├─ about.md                # 关于我
│     ├─ articles/build-personal-site.md   # 展示文章
│     └─ projects/demo-proj.md   # 项目占位
├─ .github/workflows/deploy.yml  # ★ 自动部署
├─ README.md                     # 日常使用
├─ DEPLOY.md                     # 上线 runbook
└─ PROJECT.md                    # 本文件
```

| 关键文件 | 作用 | 备注 |
|---|---|---|
| `astro.config.mjs` | `site`、不写 `base`、Starlight 配置 | 自定义域名根目录 |
| `public/CNAME` | 持久化自定义域名 | gh-pages 覆盖部署防丢 |
| `.github/workflows/deploy.yml` | push main → build → 推 gh-pages | 含 `permissions: contents: write` |
| `src/content/docs/` | 全部站点页面 | Starlight 只认此目录 |

---

## 5. 关键决策记录（Decision Log）

| 决策 | 选择 | 理由 |
|---|---|---|
| 仓库类型 | 普通仓库 `oghub`（Public） | 灵活；自定义域名下不影响最终 URL；公开仓库免费 Pages |
| 域名 | 自定义 `github.opengood.cc`（子域名） | 独立、专业；DNS 用 CNAME |
| `base` | **不写** | 自定义域名跑根目录；写了反而资源 404 |
| `public/CNAME` | 放 `github.opengood.cc` | gh-pages 覆盖式部署，无此文件域名会被冲掉 |
| 部署方案 | gh-pages 分支（JamesIves action） | 兼容性好、可视；Pages 源 = gh-pages |
| Node 版本 | 22 | 最新 Astro 生态要求 ≥22.12 |
| 内容目录 | `src/content/docs/` 下 | Starlight 约定 |

---

## 6. 对原教程的修正（按踩坑顺序）

1. **内容目录**：Starlight 只认 `src/content/docs/`，不是教程的 `src/content/articles/`。
2. **`social`**：当前 Starlight 是数组 `[{icon,label,href}]`，不是旧对象写法。
3. **侧边栏 `autogenerate`**：v0.39+ 不再允许 `{ label, autogenerate }`，须包成 `{ label, items:[{ autogenerate }] }`。
4. **Node 版本**：最新 Astro 需 Node 22+；Node 20 连脚手架都跑不起来。
5. **改 `package.json` 名称**：改完必须 `npm install` 同步 `package-lock.json`，否则 CI 的 `npm ci` 失败。
6. **私有仓库 + Pages**：GitHub Free 的 Pages 只服务公开仓库；私有仓库要 GitHub Pro（$4/月）。故迁移到公开仓库 `oghub`。

> 这些大多被本地 `build` 关卡兜住——再次印证「推送前必须 build + preview」。

---

## 7. 本地环境处理（记录）

沙箱默认 Node `20.18.0`，而最新 Astro 生态要求 Node ≥22.12。处理方式：从 nodejs.org 下载官方 Node `22.23.2`（arm64）到 `/opt/node22`，并把 `/opt/node20/bin/{node,npm,npx}` 重指向它（原 Node20 备份为 `.v20bak`），使 Node 22 在各 shell 调用间持久生效。

> 这只是沙箱构建验证用的处理；**你自己的机器按教程装 Node 22+ 即可**，无需此操作。

---

## 8. 搭设阶段回顾

| 阶段 | 内容 | 结果 |
|---|---|---|
| 1 脚手架 | `npm create astro --template starlight`（Node 22） | ✅ |
| 2 配置 | `astro.config.mjs` / `public/CNAME` / `deploy.yml` | ✅ |
| 3 内容 | 首页 + 文章 + 项目 + 关于 | ✅ |
| 4 构建验证 | `npm run build` + `preview` | ✅ 0 报错、全 200 |
| 5 git | init + 提交 + push | ✅ |
| 6 文档 | README + DEPLOY + PROJECT | ✅ |
| 7 迁移 | 迁到公开仓库 `oghub`（免费 Pages） | ✅ |

---

## 9. 验证记录

**构建**（`npm run build`）：0 报错；生成 5 个页面（首页 / 关于 / 文章 / 项目 / 404）+ Pagefind 搜索索引 + sitemap；`dist/CNAME` = `github.opengood.cc`。

**预览**（`npm run preview`，针对 `dist/`）：

| 路由 | 状态 |
|---|---|
| `/`、`/about/`、`/articles/build-personal-site/`、`/projects/demo-proj/` | 200 |
| `/does-not-exist/` | 404 |
| CSS（`/_astro/*.css`）、JS、favicon、sitemap | 200 |

结论：资源全部根相对路径，自定义域名根目录部署无 404。

---

## 10. 后续可选增强

- 用真实文章/项目替换占位内容。
- 自定义 logo / favicon（放 `public/`）。
- RSS：`@astrojs/rss`。
- 站点统计：Plausible / Umami / Google Analytics。
- 评论：giscus / utterances。
- 多语言：Starlight i18n。
- 自定义主题色 / 字体（Starlight 主题配置）。

---

## 11. 文件清单

源码与配置：`astro.config.mjs`、`package.json`、`package-lock.json`、`tsconfig.json`、`.gitignore`、`src/content.config.ts`
静态资源：`public/CNAME`、`public/favicon.svg`、`src/assets/houston.webp`
内容：`src/content/docs/{index.mdx, about.md, articles/build-personal-site.md, projects/demo-proj.md}`
部署：`.github/workflows/deploy.yml`
文档：`README.md`、`DEPLOY.md`、`PROJECT.md`
脚手架自带（可删）：`.vscode/`、`CLAUDE.md`、`AGENTS.md`

---

## 提交历史

| Commit | 说明 |
|---|---|
| `0307ba7` | init astro + starlight site (custom domain github.opengood.cc) |
| `ad6d956` | docs: 新增「搭建本站点」展示文章，首页链接更新，移除示例 hello |
| `63596d4` | chore: 应用真实身份 —— 仓库 opengood-hub / 用户 hujinnvshi |
| `101d800` | docs: 整理项目交接文档 PROJECT.md，DEPLOY 补充私有仓库注意事项 |
| （本次） | 迁移到公开仓库 oghub：重命名引用 + 文档状态更新 |
