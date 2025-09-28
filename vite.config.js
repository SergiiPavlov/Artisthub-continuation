// vite.config.js
import { defineConfig, loadEnv } from "vite";
import { glob } from "glob"; // оставляю как было у тебя
import injectHTML from "vite-plugin-html-inject";
import FullReload from "vite-plugin-full-reload";
import purgeCss from "vite-plugin-purgecss";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Для GH Pages обычно: /Artisthub-continuation/
  // Локально удобно: /
  const BASE =
    env.VITE_BASE ?? (command === "build" ? "/Artisthub-continuation/" : "/");

  const contentGlobs = [
    path.resolve(__dirname, "src/**/*.html"),
    path.resolve(__dirname, "src/**/*.js"),
  ];

  return {
    root: "src",
    base: BASE,
    build: {
      sourcemap: true,
      rollupOptions: {
        // входные html
        input: glob.sync("./src/*.html"),
      },
      outDir: "../dist",
      emptyOutDir: true,
    },
    plugins: [
      injectHTML(),
      FullReload(["./src/**/**.html", "./src/**/**.js", "./src/**/**.css"]),
      // Отключить PurgeCSS можно через NO_PURGE=1
      ...(env.NO_PURGE
        ? []
        : [
            purgeCss({
              content: contentGlobs,
              // Селекторы, которые появляются динамически
              safelist: [
                /list-view/, // режим списка
                /assistant/, // UI ассистента
                /swiper/, // Swiper стили
                /iziToast/, // iziToast
                /tui-/, // tui-pagination
                /is-on/, // состояния
              ],
            }),
          ]),
    ],

    // ⬇⬇⬇ dev-прокси на backend (Node/Express), чтобы смотреть изменения без пуша/мерджа
    server: {
      port: 5173,
      strictPort: true,
      open: true,
      proxy: {
        "/api": {
          target: env.VITE_API_TARGET || "http://localhost:3000",
          changeOrigin: true,
          ws: true,
          // rewrite не нужен, бэкенд ожидает /api/*
        },
      },
    },

    // (опционально) proxy и для vite preview
    preview: {
      port: 4173,
      strictPort: true,
      proxy: {
        "/api": {
          target: env.VITE_API_TARGET || "http://localhost:3000",
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
