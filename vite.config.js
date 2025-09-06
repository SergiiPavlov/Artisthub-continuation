// @ts-nocheck
import { defineConfig } from 'vite';
import { globSync } from 'glob';
import injectHTML from 'vite-plugin-html-inject';
import FullReload from 'vite-plugin-full-reload';
import purgeCss from 'vite-plugin-purgecss';
import { visualizer } from 'rollup-plugin-visualizer';

// Собираем все HTML в src как именованные входные точки.
// ВАЖНО: пути указываем как './src/...' (мы явно задаём root: 'src' ниже).
const inputs = Object.fromEntries(
  globSync('./src/*.html').map((file) => [
    file.replace(/^\.\/src\/|\.html$/g, ''), // имя чанка: index, about и т.п.
    file
  ])
);

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';
  const rawBase = process.env.VITE_BASE;
  const base =
    typeof rawBase === 'string' && rawBase.trim()
      ? rawBase.trim()
      : isDev
      ? '/'
      : '/Artisthub-continuation/';

  // PurgeCSS включаем только в build (и можно временно отключить NO_PURGE=1)
  const withPurge = command === 'build' && !process.env.NO_PURGE;

  return {
    base,
    root: 'src',
    publicDir: 'src/public',
    define: { global: {} },
    server: { host: true, port: 5173 },

    build: {
      outDir: '../dist',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: inputs, // <— ключ к мультистраницам и к ошибке «index.html not found»
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) return 'vendor';
          },
          entryFileNames: '[name].js',
          assetFileNames: (assetInfo) =>
            assetInfo.name && assetInfo.name.endsWith('.html')
              ? '[name].[ext]'
              : 'assets/[name]-[hash][extname]'
        }
      }
    },

    plugins: [
      injectHTML(),
      FullReload(['src/**/*.html']),
      withPurge &&
        purgeCss({
          content: ['src/**/*.html', 'src/**/*.js'],
          // спасаем динамические классы/селекторы режима списка
          safelist: {
            standard: [
              'list-view', 'layout-list', 'view-list', 'mode-list',
              'active', 'hidden', 'open'
            ],
            greedy: [
              /\[data-view=['"]?list['"]?\]/, // [data-view="list"]
              /\.list-view(\s|$)/
            ],
            // если есть вложенные правила .list-view .card — тоже не трогаем
            deep: [/\.list-view\s+\.card/]
          }
        }),
      visualizer({ filename: 'dist/stats.html', brotliSize: true, gzipSize: true })
    ].filter(Boolean)
  };
});
