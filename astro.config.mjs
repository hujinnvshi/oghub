// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  // 自定义域名 github.opengood.cc 跑在域名「根目录」，所以不配置 base。
  // （只有用 https://用户名.github.io/仓库名/ 这种带子路径的地址时才需要 base。）
  // site 决定构建产物里的 canonical 链接 / sitemap 指向。
  site: 'https://github.opengood.cc',
  integrations: [
    starlight({
      title: 'OpenGood',
      tagline: '向善 · 开放',
      logo: { src: './src/assets/logo.svg', alt: 'OpenGood' },
      customCss: ['./src/styles/theme.css'],
      components: { Head: './src/components/Head.astro' },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/hujinnvshi/oghub' },
        { icon: 'rss', label: 'RSS', href: '/rss.xml' },
      ],
      sidebar: [
        // Starlight v0.39+：autogenerate 不能直接带 label，要包在 { label, items: [...] } 里
        { label: '📰 新闻动态', items: [{ autogenerate: { directory: 'news' } }] },
        { label: '🛠️ 技术方案', items: [{ autogenerate: { directory: 'tech' } }] },
        { label: '🚀 项目', items: [{ autogenerate: { directory: 'projects' } }] },
        { label: '👋 关于我', slug: 'about' },
      ],
    }),
  ],
});
