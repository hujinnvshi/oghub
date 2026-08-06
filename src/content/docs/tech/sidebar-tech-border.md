---
title: 给侧边栏某个分组的文章标题加自定义边框
description: 用 href 属性选择器精准定位 Starlight 侧边栏「技术方案」分组，给文章标题加浅绿粗虚线圆角框；附定位思路与踩坑。
pubDate: 2026-08-06
---

OpenGood 的侧边栏分了「新闻动态 / 技术方案 / 项目 / 关于」四组。我想给**「技术方案」**分组下的每篇文章标题，套一个**浅绿粗虚线圆角框**做视觉强调——而且只这一组，别的组不动。这篇记录怎么精准做到。

> 顺带一提：这篇文档本身也在 `/tech/` 下，所以它的侧边栏链接也自动套上了这个框——算个活演示。

## 难点：怎么只选中「技术方案」这一组？

Starlight 的侧边栏分组，**渲染时没有任何 per-group 的 class 或 data 属性**（看 `SidebarSublist.astro` 源码就清楚：分组是 `<details><summary>`，链接是 `<a>`，都没有标识某个分组的钩子）。也就是说，CSS 没法靠「分组名叫技术方案」去选。

三条候选路：

| 思路 | 问题 |
|---|---|
| 按位置 `:nth-child(2)` | 脆——分组顺序一变（加/删/挪）就选错 |
| 覆盖 Sidebar 组件加 data 属性 | 重——要整段复制 Starlight 内部组件，升级易碎 |
| **`href` 属性选择器** | ✅ 稳——按链接地址选，不依赖顺序、不碰组件 |

## 方案：用 `href` 属性选择器

「技术方案」分组的文章链接，href 都是 `/tech/...`（绝对路径）。所以：

```css
.top-level a[href^="/tech/"]
```

- `.top-level` 是侧边栏根列表（`SidebarSublist.astro` 里 `<ul class:list={{ 'top-level': !nested }}>`）。
- `a[href^="/tech/"]` = href 以 `/tech/` 开头的链接，正好命中「技术方案」的文章。
- **只作用于侧边栏**：正文里若有 `/tech/` 链接，它不在 `.top-level` 下，不受影响。

## 样式：浅绿 + 粗 + 虚线 + 圆角

加到现有的 `src/styles/theme.css`（已通过 `customCss` 接入）：

```css
/* 侧边栏「技术方案」文章标题：浅绿粗虚线圆角框（仅 tech 分组） */
:root { --og-tech-link-border: #5fd49a; }                       /* 浅绿（暗色模式）*/
:root[data-theme='light'] { --og-tech-link-border: #2fa474; }   /* 亮色模式略深 */

.top-level a[href^="/tech/"] {
  border: 2px dashed var(--og-tech-link-border);
  border-radius: 0.5rem;
}
```

颜色用 CSS 变量按暗/亮模式给不同深浅：暗色模式用浅绿，亮色模式略深以保证对比可见。

## 为什么能盖过 Starlight 默认样式？

Starlight 的侧边栏样式包在 `@layer starlight.core { ... }` 里。而 `theme.css` 是**非 layered** 的普通 CSS——按 CSS Cascade 规则，**非 layered 永远赢过 layered**，跟选择器特异性无关。所以这里的 `border` / `border-radius` 直接生效，不用 `!important`。

> 这是 Astro/Starlight 自定义样式的关键机制：把覆盖样式放非 layered 的 customCss 里，就能干净地压过主题默认。

## 复用到别的分组

想给「新闻动态」也加，把选择器里的 `/tech/` 换成 `/news/` 即可；想几组共用，逗号并列：

```css
.top-level a[href^="/tech/"],
.top-level a[href^="/news/"] {
  border: 2px dashed var(--og-tech-link-border);
  border-radius: 0.5rem;
}
```

## 可调项（一行就改）

- 颜色 → `--og-tech-link-border`
- 粗细 → `border: 2px`（`3px` 更粗）
- 圆角 → `border-radius: 0.5rem`
- 线型 → `dashed` 换 `solid`（实线）/ `dotted`（点线）

## 小结

- Starlight 侧边栏分组无 per-group 钩子 → **用 `href` 属性选择器**精准定位，比按位置稳、比覆盖组件轻。
- 覆盖样式放**非 layered** 的 customCss，干净压过主题默认，无需 `!important`。
- 一条 CSS 规则就够，零 JS、零组件改动。
