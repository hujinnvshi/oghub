---
title: 给首页加粒子连线背景动效（Constellation）
description: 用纯前端 Canvas 在静态站首页实现粒子连线动效；含层级（z-index）处理、无障碍与性能要点。
pubDate: 2026-08-06
---

很多人觉得"那种线段不断连接"的动效很酷，但不确定**静态站能不能做**。能——它是纯前端 Canvas + JS，不需要任何后端。这篇记录我给 OpenGood 首页加的这个粒子连线背景。

## 效果与选型

经典「粒子网络」：一堆小节点缓慢漂移，相邻节点之间连线，距离越近线越亮。

选型上没上 `tsparticles`（功能多但 ~100KB+，重），而是**手写 ~70 行原生 Canvas**：更轻、完全可控、无依赖。

## 核心实现

新建 `src/components/Constellation.astro`，本质上就一个 `<script>`：

```js
const canvas = document.createElement('canvas');
canvas.style.cssText =
  'position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;opacity:.55';
document.body.prepend(canvas);
// …节点数组 + requestAnimationFrame 循环：移动、边缘反弹、相邻连线、画节点
```

首页 `index.mdx` 引入：

```mdx
import Constellation from '../../components/Constellation.astro';
<Constellation />
```

## 关键点一：为什么 `prepend` 到 `<body>` + `z-index:-1`

这是能不能"看见"的关键。目标是画布在**底色之上、正文之下**。

- **背景传播**：Starlight 把页面底色设在 `body` 上（`reset.css` 里 `body { background-color: var(--sl-color-bg) }`）。按 CSS 规则，`<html>` 无背景时，`<body>` 的背景会**传播到视口（canvas）**——等于底色画在最底层，`body` 本身变透明。
- 所以把画布作为 `body` 的**直接子节点**、`z-index:-1`，它就稳定画在「视口底色」之上、「正文流」之下，看得见又不挡字。
- 如果把画布放进某个中间容器，而那容器有不透明背景，就会把画布盖住——这就是为什么用 `document.body.prepend()` 直接挂到 body。

## 关键点二：颜色读 CSS 变量，暗/亮自适应

```js
const accent = () =>
  getComputedStyle(document.documentElement)
    .getPropertyValue('--sl-color-accent')
    .trim() || '#1ae686';
```

每帧读 `--sl-color-accent`（OpenGood 翠青绿），主题切换时颜色自动跟着变。

## 关键点三：无障碍 + 性能

- **`prefers-reduced-motion`**：系统开了"减少动效"就只画一帧静态，不跑动画循环。
- **`requestAnimationFrame`** + 切后台 `visibilitychange` 暂停，不空耗。
- **`devicePixelRatio`** 缩放，高清屏不糊；节点数按视口面积算、封顶 90，O(n²) 连线检查也就几千次/帧，毫无压力。
- **`pointer-events:none`** + `aria-hidden`：纯装饰，不挡点击、屏幕阅读器忽略。

## 关键点四：只在首页加载

Astro 会把组件里的 `<script>` **按页打包**——只有渲染了 `<Constellation />` 的页面（首页）才带这段脚本，内容页零开销。

## 小结

- 静态站完全能做动态视觉效果，纯前端 Canvas 即可，无需后端。
- 画布 `prepend` 到 `body` + `z-index:-1`，靠 CSS 背景传播规则稳稳落在底色与正文之间。
- 无障碍（reduced-motion）+ 性能（rAF / DPR / 暂停 / 封顶）+ 按页加载，都顾上了。
