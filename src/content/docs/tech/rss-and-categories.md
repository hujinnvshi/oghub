---
title: 给 OpenGood 加上「内容分类」与「RSS 订阅」
description: 记录用 Astro + Starlight 实现文章目录式分类与 RSS 订阅源的过程、关键配置与两个踩坑。
pubDate: 2026-08-06
---

站点内容多了之后，两个刚需冒出来：一是**分类**（文章不能都堆在一处），二是 **RSS**（让读者订阅、不用天天来刷）。这篇记录我怎么在**不引入任何后端**的前提下，给 OpenGood 加上这两样。

## 目标

- **分类**：按内容类型（新闻 / 技术方案 / 项目）分门别类，侧边栏清晰可导航。
- **RSS**：提供 `/rss.xml` 订阅源，页头有按钮、支持自动发现。
- **约束**：仍是纯静态、零运维，不动现有品牌/部署。

## 一、内容分类：用「目录」当分类

Starlight 的侧边栏可以**按目录自动生成分组**——把文章放进对应子目录，侧边栏就自动出现分组。无需数据库、无需标签系统。

### 信息架构

把原来单一的「文章」拆成顶级分类，「项目」复用已有分类避免重复：

| 侧边栏分组 | 目录 | 内容 |
|---|---|---|
| 新闻动态 | `src/content/docs/news/` | 公告、动态 |
| 技术方案 | `src/content/docs/tech/` | 技术文章、方案 |
| 项目 | `src/content/docs/projects/` | 项目介绍 |
| 关于 | `about` | 关于 OpenGood |

### 侧边栏配置

```js
// astro.config.mjs
starlight({
  sidebar: [
    { label: '新闻动态', items: [{ autogenerate: { directory: 'news' } }] },
    { label: '技术方案', items: [{ autogenerate: { directory: 'tech' } }] },
    { label: '项目', items: [{ autogenerate: { directory: 'projects' } }] },
    { label: '关于我', slug: 'about' },
  ],
})
```

> ⚠️ **踩坑一**：Starlight **v0.39+** 不再支持 `{ label: 'x', autogenerate: {...} }` 这种「带 label 的自动生成」。必须包成 `{ label: 'x', items: [{ autogenerate: {...} }] }`。直接写旧形式，构建期会报错。

文章放进对应目录即自动归类，新增分类只要建目录 + sidebar 加一行。

## 二、RSS 订阅源

### 1. 装包

```bash
npm install @astrojs/rss
```

### 2. 给文章加发布日期

RSS 需要按时间排序，得有个 `pubDate`。Starlight 的内容 schema 默认没有这个字段，扩展一下：

```ts
// src/content.config.ts
import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({ extend: z.object({ pubDate: z.date().optional() }) }),
  }),
};
```

> ⚠️ **踩坑二**：`docsSchema({ extend })` 的回调参数**不是** `z`（它实际是 `{ image }` 之类的助手对象）。写成 `(z) => z.date()` 会报 `z.date is not a function`。正确做法：从 `astro:content` 导入 `z`，**直接传一个 `z.object(...)`**。

文章 frontmatter 加上：

```yaml
---
title: 文章标题
pubDate: 2026-08-06
---
```

### 3. 生成 feed

新建 `src/pages/rss.xml.js`，从内容集合里取「新闻 + 技术」、按日期倒序：

```js
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const posts = (
    await getCollection('docs', ({ id }) => id.startsWith('news/') || id.startsWith('tech/'))
  )
    .filter((p) => p.data.pubDate)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

  return rss({
    title: 'OpenGood',
    description: '向善 · 开放',
    site: context.site,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.pubDate,
      link: p.url ?? `/${p.id}/`,
    })),
    customData: '<language>zh-cn</language>',
  });
}
```

### 4. 页头 RSS 按钮

`rss` 是 Starlight **内置**的社交图标，配置里加一行就有按钮：

```js
social: [
  { icon: 'github', label: 'GitHub', href: 'https://github.com/hujinnvshi/oghub' },
  { icon: 'rss', label: 'RSS', href: '/rss.xml' },
],
```

### 5. RSS 自动发现

让 RSS 阅读器输入站点地址就能自动找到 feed。Starlight 没有配置项加自定义 `<head>` 标签，覆盖一下 `Head` 组件即可：

```astro
---
<!-- src/components/Head.astro -->
const { head } = Astro.locals.starlightRoute;
---
{head.map(({ tag: Tag, attrs, content }) => <Tag {...attrs} set:html={content} />)}
<link rel="alternate" type="application/rss+xml" title="OpenGood" href="/rss.xml" />
```

注册：

```js
starlight({ components: { Head: './src/components/Head.astro' }, /* ... */ })
```

## 验证

- `npm run build` 0 报错，生成 `dist/rss.xml`（含 `<item>`）。
- 预览：侧边栏出现四个分组；`/rss.xml` 返回有效 RSS；页头有 RSS 按钮。
- push 后线上 `https://github.opengood.cc/rss.xml` 可订阅。

## 日常用法（最大收益）

写一篇新文章，**自动归类 + 自动进 RSS**：

1. 放进对应目录，如 `src/content/docs/tech/my-post.md`。
2. frontmatter 加 `pubDate`。
3. `git push`。

侧边栏自动多一条，RSS 自动多一项，零额外配置。

## 小结

- **分类** = 目录 + `autogenerate`，零数据库。
- **RSS** = `@astrojs/rss` 端点 + `pubDate` 字段 + 头部按钮 + Head 覆盖。
- **两个坑**：Starlight v0.39 的 sidebar 写法、`docsSchema` 的 `extend` 要用导入的 `z`。

整套仍是纯静态，写完 push 即发布。
