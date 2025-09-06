import { defineConfig } from 'vite';
import { glob } from 'glob';
import injectHTML from 'vite-plugin-html-inject';
import FullReload from 'vite-plugin-full-reload';
import purgeCss from 'vite-plugin-purgecss';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';
  return {
    base: isDev ? '/' : '/Artisthub-continuation/',
    root: 'src',
    publicDir: 'src/public',
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: glob.sync('./src/*.html'),
        output: {
          manualChunks(id) { if (id.includes('node_modules')) return 'vendor'; },
          entryFileNames: c => (c.name === 'commonHelpers' ? 'commonHelpers.js' : '[name].js'),
          assetFileNames: a => (a.name && a.name.endsWith('.html')
            ? '[name].[ext]'
            : 'assets/[name]-[hash][extname]'),
        },
      },
    },
    plugins: [
      injectHTML(),
      FullReload(['./src/**/**.html']),
      purgeCss({
        content: ['./src/index.html', './src/**/*.html', './src/**/*.js'],
        safelist: [/^is-/, /^btn-/, /^toast-/, /^active$/, /^hidden$/, /^open$/],
      }),
      visualizer({ filename: 'dist/stats.html', brotliSize: true, gzipSize: true }),
    ],
  };
});
