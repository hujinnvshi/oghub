---
title: 从零搭建 Astro + Starlight 个人站点（GitHub Pages + 自定义域名）
description: 记录用 Astro + Starlight 搭建个人静态站点、部署到 GitHub Pages 并绑定自定义域名的完整过程、关键决策与踩坑总结。
pubDate: 2026-08-06
---

我把「搭建这个站点」本身当作第一篇真实文章——既是内容示范，也是一次完整记录。

## 为什么是这套技术栈

- **Astro**：现代静态站点生成器（SSG），把 Markdown / 组件编译成纯 HTML/CSS/JS，快、精简、无运行时。
- **Starlight**：Astro 官方文档主题，开箱即用——侧边栏、全文搜索、响应式、暗色模式。
- **GitHub Pages**：免费静态托管；配合 GitHub Actions，push 即自动构建部署。

核心诉求：**写 Markdown，剩下全自动**。没有数据库、没有服务器、没有运维。

## 整体架构

```
你写 .md ──npm run build──▶ dist/（纯静态文件）
git push main ──▶ GitHub Actions 重新 build ──▶ 把 dist 推到 gh-pages 分支
GitHub Pages 服务 gh-pages 分支 ──▶ https://github.opengood.cc
```

两个分支各司其职：

- `main`：源码（你维护的内容与配置）。
- `gh-pages`：Actions 自动生成的构建产物，**不要手动改**。

## 内容放哪里

所有页面都在 `src/content/docs/` 下，按目录自动出现在侧边栏：

```
src/content/docs/
├─ index.mdx          # 首页
├─ about.md           # 关于我
├─ articles/          # 文章（侧边栏「文章」自动生成）
└─ projects/          # 项目（侧边栏「项目」自动生成）
```

每个 `.md` 文件头部需要 `title`：

```markdown
---
title: 文章标题
description: 一句话摘要
---

正文……
```

## 自定义域名（本站点的核心配置）

本站用自定义域名 `github.opengood.cc`，跑在域名根目录，需要四处配合。

**1. `astro.config.mjs` —— `site` 写域名，不写 `base`：**

```js
export default defineConfig({
  site: 'https://github.opengood.cc',
  // 不写 base：根目录部署
  integrations: [starlight({ /* ... */ })],
});
```

为什么不写 `base`？`base` 是给「带子路径」的地址用的（如 `用户名.github.io/仓库名/`）。自定义域名跑在根目录、没有子路径，写了反而会让所有静态资源 404。

**2. `public/CNAME`** —— 文件内容一行 `github.opengood.cc`。

这是防丢的关键：gh-pages 是覆盖式部署，每次 Actions 都会重写整个分支。如果只在 GitHub 后台设了自定义域名、而部署内容里没有 `CNAME` 文件，**下一次部署就会把域名设置冲掉**。放在 `public/` 下，Astro 构建时会原样复制进 `dist/`。

**3. DNS 解析** —— 在域名服务商后台加一条 CNAME：

| 类型 | 主机记录 | 记录值 |
|---|---|---|
| CNAME | `github` | `hujinnvshi.github.io.`（结尾有点） |

**4. GitHub Pages 后台** —— Source = `Deploy from a branch` → `gh-pages` / `(root)`；Custom domain 填域名；勾 Enforce HTTPS。

## 部署流水线（GitHub Actions）

```yaml
on:
  push:
    branches: [main]
permissions:
  contents: write   # Action 要有写权限才能推 gh-pages
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: JamesIves/github-pages-deploy-action@v4.6.4
        with:
          branch: gh-pages
          folder: dist
```

## 本地工作流（推送前的关卡）

```bash
npm run dev        # 实时预览
npm run build      # 构建，必须 0 报错
npm run preview    # 预览 dist，逐页检查无 404
git add . && git commit -m "..." && git push
```

> **不要只看 dev 效果就推送。** 很多问题只在 `build` 后才暴露（配置错误、链接失效、资源 404）。本地 `dist` 正常，上线才大概率正常。

## 踩过的坑（按出现频率排序）

1. **`base` 配置错** → 样式全丢。普通仓库默认地址需要 base；自定义域名根目录**不要** base。
2. **缺 `public/CNAME`** → 每次部署后自定义域名失效。
3. **Starlight 内容目录** → 必须在 `src/content/docs/` 下，不是 `src/content/`。
4. **Starlight API 变更** → `social` 用数组；侧边栏 `autogenerate` 要包在 `{ label, items:[...] }` 里（v0.39+）。
5. **Node 版本** → 最新 Astro 需要 Node 22+，旧版本连脚手架都跑不起来。
6. **Actions 权限** → 需 `permissions: contents: write`，否则推不了 gh-pages。

## 验证清单

- [ ] Actions 绿色 ✅
- [ ] 首页样式、导航正常
- [ ] 文章 / 项目 / 关于页都能打开
- [ ] 没有 404，图片能加载
- [ ] 地址栏有 HTTPS 锁

## 小结

整套方案的核心思想：**源码在 `main`、产物在 `gh-pages`、Actions 负责把前者变成后者**。理解了这条数据流，配置和排错都有了抓手。剩下的，就是安心写内容。
