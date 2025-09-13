// eslint.config.js
import js from "@eslint/js";
import globals from "globals";

export default [
  // игнор сборок/отчётов
  { ignores: ["dist/**", "reports/**", "node_modules/**"] },

  // базовые рекомендации
  js.configs.recommended,

  // конфиги (Node-окружение)
  {
    files: ["vite.config.js", "postcss.config.cjs", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node }
    }
  },

  // исходники (браузер)
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser }
    },
    rules: {
      "no-undef": "error",
      // временно выключаем, чтобы пустые блоки не сыпались ошибками
      "no-empty": "off",
      // предупреждения за неиспользуемые — оставим мягко
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  }
];
