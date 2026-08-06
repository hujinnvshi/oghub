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
      title: '我的站点',
      // TODO: 把下面的 GitHub 链接换成你自己的仓库地址
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/你的用户名/my-site' },
      ],
      sidebar: [
        // Starlight v0.39+：autogenerate 不能直接带 label，要包在 { label, items: [...] } 里
        { label: '文章', items: [{ autogenerate: { directory: 'articles' } }] },
        { label: '项目', items: [{ autogenerate: { directory: 'projects' } }] },
        { label: '关于我', slug: 'about' },
      ],
    }),
  ],
});
