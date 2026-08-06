---
title: 侧边栏分组加 emoji 图标 + 虚线框微调
description: 给 Starlight 侧边栏分组前加 emoji 图标，并把技术方案文章的虚线框改细、加间隔；附为什么用 emoji 与为什么加 margin。
pubDate: 2026-08-06
---

OpenGood 的侧边栏分了「新闻动态 / 技术方案 / 项目 / 关于我」四组。两件小事让它更好看：分组名前**加图标**；之前给「技术方案」文章标题加的虚线框太粗，**改细 + 加间隔**。

## 一、分组前加 emoji 图标

### 想法与坑
想在每个分组名前放个小图标。问题是 Starlight 的侧边栏分组**没有 per-group 的 class/属性**，分组名是纯文本渲染（`SidebarSublist.astro` 里 `<span class="large">{entry.label}</span>`）。所以：

- 想用**矢量 SVG** 图标 → 得覆盖侧边栏组件，工程量大、升级易碎。
- 想用 **CSS `::before`** → 没法精准定位到某个分组（无 per-group 钩子）。

### 解法：把 emoji 放进 label 文本
label 本来就是纯文本，emoji 是字符，直接写进去就渲染在最前面——零组件改动、不依赖位置：

```js
// astro.config.mjs
sidebar: [
  { label: '📰 新闻动态', items: [{ autogenerate: { directory: 'news' } }] },
  { label: '🛠️ 技术方案', items: [{ autogenerate: { directory: 'tech' } }] },
  { label: '🚀 项目', items: [{ autogenerate: { directory: 'projects' } }] },
  { label: '👋 关于我', slug: 'about' },
]
```

> 取舍：emoji 各平台样式略有差异，但够用且最省稳；要完全统一的矢量图标再考虑覆盖组件。

## 二、虚线框：变细 + 加间隔

之前给「技术方案」文章标题加的虚线框是 `2px`，**相邻两篇文章的边框贴合在一起，看着像一条很粗的线**，不美观。

两个调整（`src/styles/theme.css`）：

```css
.top-level a[href^="/tech/"] {
  border: 1px dashed var(--og-tech-link-border);   /* 2px → 1px，更细 */
  border-radius: 0.5rem;
  margin-bottom: 0.25rem;                           /* 关键：加间隔，避免贴合 */
}
```

- **`1px`**：边框本身更细。
- **`margin-bottom`**：让相邻文章框之间留出空隙，边框不再贴在一起——这才是「显粗」的根因（贴合 = 两条 2px 叠成一条粗线）。

## 小结

- **图标**：分组无 per-group 钩子 → 把 emoji 放进 label 文本，最省稳。
- **虚线框显粗**：根因是相邻边框贴合 → 改细（`1px`）+ 加 `margin-bottom` 间隔。
- 两处都是一行配置 / 几行 CSS，零组件改动。
