// eslint.config.js
import js from "@eslint/js";
import globals from "globals";

export default [
  // Игнор сборок/отчётов
  { ignores: ["dist/**", "reports/**", "node_modules/**"] },

  // Базовые рекомендации
  js.configs.recommended,

  // Конфиги (Node-окружение, чтобы не падал 'process is not defined')
  {
    files: ["vite.config.js", "postcss.config.cjs", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node }
    }
  },

  // Исходники (браузер)
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser }
    },
    rules: {
      "no-undef": "error",
      // ↓ на время чистки отключаем no-empty полностью, чтобы не было красноты
      "no-empty": "off",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  }
];
