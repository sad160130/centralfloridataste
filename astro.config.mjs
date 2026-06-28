// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// `site` drives canonical URLs, Open Graph URLs, and sitemap.xml entries.
export default defineConfig({
  site: 'https://centralfloridataste.org',
  output: 'static',
  integrations: [sitemap()],
});
