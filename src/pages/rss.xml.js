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
