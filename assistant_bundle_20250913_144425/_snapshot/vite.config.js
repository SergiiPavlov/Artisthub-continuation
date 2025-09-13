// vite.config.js
import { defineConfig, loadEnv } from "vite";
import { glob } from "glob";
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
                /list-view/,      // режим списка
                /assistant/,      // UI ассистента
                /swiper/,         // Swiper стили
                /iziToast/,       // iziToast
                /tui-/,           // tui-pagination
                /is-on/,          // состояния
              ],
            }),
          ]),
    ],
  };
});
