# 我的个人站点（Astro + Starlight）

基于 [Astro](https://astro.build) + [@astrojs/starlight](https://starlight.astro.build) 的个人静态站点，用于托管文章、项目介绍与关于页，通过 GitHub Actions 自动部署到 GitHub Pages。

- **线上地址（自定义域名）**：https://github.opengood.cc
- **部署方式**：push `main` → GitHub Actions 构建 → 推送到 `gh-pages` 分支 → Pages 服务 `gh-pages`

> 首次上线（建仓库、配 DNS、绑域名）见 [DEPLOY.md](./DEPLOY.md)。本文件面向「日常开发与更新」。

## 目录结构

```
.
├─ astro.config.mjs          # 站点配置：site / sidebar / social
├─ public/
│  ├─ CNAME                  # 自定义域名（构建时复制进 dist，避免被覆盖）
│  └─ favicon.svg
├─ src/
│  ├─ assets/                # 图片资源（在 md 里相对引用，Astro 会优化）
│  ├─ content/
│  │  └─ docs/               # ★ 所有页面都在这里（Starlight 只认这个目录）
│  │     ├─ index.mdx        # 首页
│  │     ├─ about.md         # 关于我
│  │     ├─ articles/        # 文章
│  │     │  └─ hello.md
│  │     └─ projects/        # 项目
│  │        └─ demo-proj.md
│  └─ content.config.ts      # 内容集合定义（Starlight docsLoader）
├─ .github/workflows/
│  └─ deploy.yml             # 自动部署脚本
└─ package.json
```

## 环境要求

- Node.js **22+**（`node -v` 检查）
- git

## 本地命令

| 命令 | 作用 |
|---|---|
| `npm install` | 安装依赖 |
| `npm run dev` | 本地开发服务器 http://localhost:4321（实时预览、热更新） |
| `npm run build` | 构建生产产物到 `dist/`（**推送前必跑**） |
| `npm run preview` | 本地预览 `dist/`（模拟线上环境） |

## 写新内容

所有页面都是 `src/content/docs/` 下的 Markdown（`.md`）或 MDX（`.mdx`）文件。

- **新文章**：在 `src/content/docs/articles/` 新建 `xxx.md`
- **新项目**：在 `src/content/docs/projects/` 新建 `xxx.md`
- 文件头需要 `title`（必填）和 `description`：

```markdown
---
title: 文章标题
description: 一句话摘要
---

正文用 Markdown 写……
```

侧边栏「文章」「项目」是**按目录自动生成**的，新增文件后会自动出现在导航里，无需改配置。

> 改「关于我」或首页：直接编辑 `src/content/docs/about.md` / `index.mdx`。
> 改站点标题、社交链接：编辑 `astro.config.mjs`。

## 推送前的硬性检查（重要）

```bash
npm run build       # 必须 0 报错
npm run preview     # 浏览器逐页检查：链接、图片、样式、无 404
```

本地 `dist` 正常，上线才大概率正常；本地就报错，上线一定出问题。

## 日常更新流程

```bash
npm run dev          # 边写边预览
npm run build        # 构建校验
npm run preview      # 预览 dist
git add .
git commit -m "update: 新增文章 xxx"
git push             # 触发 GitHub Actions 自动部署
```

push 后几分钟，https://github.opengood.cc 自动更新。

## 关键配置说明

- `astro.config.mjs` 里 `site: 'https://github.opengood.cc'`，**不写 `base`**：因为站点跑在自定义域名根目录。
- `public/CNAME` 内容为 `github.opengood.cc`：让 gh-pages 覆盖式部署时不丢失自定义域名设置（**不要删**）。
- `public/.nojekyll`（空文件）：禁用 GitHub Pages 的 Jekyll，否则 `_astro/` 等下划线开头的目录会被丢弃、样式 404。
- `.github/workflows/deploy.yml`：push `main` 时用 Node 22 构建，把 `dist` 推到 `gh-pages` 分支。

## 图片

- 放 `src/assets/`，在 md 里用相对路径引用（Astro 会自动优化压缩）。
- 或放 `public/`，用绝对路径 `/xxx.png` 引用（不优化，原样输出）。

## 相关文档

- 项目全貌 / 决策记录 / 交接：[PROJECT.md](./PROJECT.md)
- 首次上线 / 域名 / 部署排错：[DEPLOY.md](./DEPLOY.md)
- [Starlight 文档](https://starlight.astro.build) · [Astro 文档](https://docs.astro.build)
