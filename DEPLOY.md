# 部署上线指南（DEPLOY）

本文档面向**首次上线**：把本地项目部署到 GitHub Pages 并绑定自定义域名 `github.opengood.cc`。日常更新见 [README.md](./README.md)。

> 本项目对应仓库：`hujinnvshi/oghub`（SSH：`git@github.com:hujinnvshi/oghub.git`）

## 前置条件

- GitHub 账号
- 本地已装 Node.js **22+**、git
- 拥有 `opengood.cc` 的 DNS 解析控制权（域名注册商或 DNS 服务商后台）
- **仓库需为 Public**：GitHub Free 的 Pages 只服务**公开**仓库。`oghub` 已是 Public，满足条件（旧仓库 opengood-hub 是 Private，已弃用）。

## 部署原理（理解这一段，排错不慌）

```
你写 md ──npm run build──▶ dist/（纯静态文件）
git push main ──▶ GitHub Actions 重新 build ──▶ 把 dist 推到 gh-pages 分支
GitHub Pages 服务 gh-pages 分支 ──▶ https://github.opengood.cc
```

- `main` 分支：源码。
- `gh-pages` 分支：Actions 自动生成、自动维护，**不要手动改**。
- `public/CNAME` 随构建进入 `dist/`，告诉 GitHub 这个站点的自定义域名是 `github.opengood.cc`。

## 一次性上线步骤

### A. GitHub 仓库（已创建）
- 普通仓库 `hujinnvshi/oghub`。
- SSH 地址：`git@github.com:hujinnvshi/oghub.git`

### B. 配置 DNS 解析（在 opengood.cc 的 DNS 后台）
添加一条 CNAME 记录：

| 类型 | 主机 / 主机记录 | 记录值 |
|---|---|---|
| CNAME | `github` | `hujinnvshi.github.io.`（**结尾有个点**） |

> 解析生效通常几分钟到几十分钟。可用 `dig github.opengood.cc` 或 `nslookup github.opengood.cc` 核对。

### C. 关联远程仓库并推送（本地）
```bash
git remote add origin git@github.com:hujinnvshi/oghub.git
git push -u origin main
```
> 如果是把项目目录拷到新机器上，先确保已 `git init` 并完成首次 commit（`git status` 应是 clean）。

### D. 确认 Actions 已启用 + 写权限
- 仓库 Settings → Actions → General：确保选了 **Allow all actions and reusable workflows**（新仓库默认允许；组织/企业账号可能默认禁用）。
- 工作流 `.github/workflows/deploy.yml` 已声明 `permissions: contents: write`，Action 才能推 `gh-pages` 分支。
- 若 Actions 仍报权限错误：Settings → Actions → General → Workflow permissions 选 **Read and write permissions**。

### E. 配置 Pages + 绑定自定义域名
仓库 Settings → Pages：
1. **Source** = `Deploy from a branch`
2. **Branch** = `gh-pages`，目录 = `/ (root)`，Save。
   - 第一次 push 后 Actions 才会创建 `gh-pages` 分支；下拉框看不到就等 1–2 分钟再刷新。
3. **Custom domain** 填 `github.opengood.cc` → Save。
4. 勾选 **Enforce HTTPS**（证书几分钟内自动签发）。

### F. 查看构建并访问
- 仓库 → Actions，等绿色 ✅。
- 访问 https://github.opengood.cc 验证。

## ⚠️ 关于「默认地址样式丢失」（属预期，别慌）

本站用自定义域名跑在根目录，**没有配置 `base`**。因此：
- 域名生效后，https://github.opengood.cc 一切正常 ✅
- 但在域名绑定/生效**之前**，默认地址 `https://hujinnvshi.github.io/oghub/` 会**样式丢失**——这是预期的（因为没有 base、根目录指向自定义域名）。绑定域名后即正常。

## 验证清单（逐项打勾）

- [ ] Actions 显示绿色 ✅
- [ ] https://github.opengood.cc 首页样式、导航正常
- [ ] 文章页、项目页、关于页都能打开
- [ ] 没有 404，图片能加载
- [ ] 浏览器地址栏有 HTTPS 锁标志

## 故障排查

| 现象 | 原因 / 解决 |
|---|---|
| 样式全丢、资源 404 | `base` 配置错。本站用自定义域名根目录，**不要写 base**；确认 `astro.config.mjs` 没有 `base`。 |
| 页面能开但样式乱（`_astro/*.css` 404） | gh-pages 用 Jekyll 处理，会丢掉 `_` 开头的 `_astro/` 目录。加空文件 `public/.nojekyll` 禁用 Jekyll（本项目已加）。 |
| 自定义域名每次部署后失效 | 缺 `public/CNAME`。本仓库已含，**不要删**。 |
| Actions 失败：permission denied | 见步骤 D；确认 `.github/workflows/deploy.yml` 有 `permissions: contents: write`。 |
| Actions 失败：npm ci 报错 | `package-lock.json` 与依赖不一致。本地重跑 `npm install` 后重新提交 `package-lock.json`。 |
| Actions 失败：Node 版本 | workflow 用 Node 22；本地也用 Node 22；`package.json` 不要强制更高版本。 |
| 域名打不开 / 不稳定 | DNS 未生效或记录错。`dig github.opengood.cc` 应解析到 GitHub Pages。 |
| HTTPS 证书未签发 | 绑定域名后等几分钟；确认 DNS 已生效再勾 Enforce HTTPS。 |
| 改了内容线上没更新 | 确认 push 到 `main` 且 Actions 绿勾；浏览器可能缓存，强刷 Ctrl+Shift+R。 |
| 站点打不开 / Pages 提示不可用 | 仓库是 Private 且账号为 Free：GitHub Free 的 Pages 只支持公开仓库。把仓库设为 Public（免费），或升级 GitHub Pro（$4/月）。 |

## 升级提示

- 本项目用当前最新的 Astro 7 + Starlight，**需要 Node 22+**（本地与 CI 都是）。
- 若本地仍是 Node 20，`npm create astro@latest` 等工具会拒绝运行；请升级到 Node 22。
