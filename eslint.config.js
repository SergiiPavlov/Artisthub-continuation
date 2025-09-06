// eslint.config.js
import js from "@eslint/js";
import globals from "globals";

export default [
  // Игнор мусора/сборок
  { ignores: ["dist/**", "reports/**", "node_modules/**"] },

  // База
  js.configs.recommended,

  // Конфиги (Node окружение)
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
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // В проекте много легитимных пустых catch — не считаем их ошибкой
      "no-empty": ["warn", { allowEmptyCatch: true }]
    }
  }
];
