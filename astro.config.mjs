// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// NOTE: replace `site` with the final production domain before launch —
// it drives canonical URLs, Open Graph URLs, and sitemap.xml entries.
export default defineConfig({
  site: 'https://www.centralfloridarestaurants.com',
  output: 'static',
  integrations: [sitemap()],
});
