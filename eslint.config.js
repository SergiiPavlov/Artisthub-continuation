// eslint.config.js
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js", "vite.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      // <<< главная фишка: включаем браузерные глобали
      globals: {
        ...globals.browser,   // window, document, localStorage, fetch, etc.
        ...globals.es2021,
        YT: "readonly"        // YouTube IFrame API, чтобы не ругался
      }
    },
    rules: {
      // игнор для неиспользуемых аргументов/переменных вида _mode, _e и т.п.
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      // много пустых блоков try{}catch{} — не падаем, только предупреждаем
      "no-empty": ["warn", { "allowEmptyCatch": true }],
      // если хочешь — можно выключить придирки к console:
      // "no-console": "off"
    }
  }
];
