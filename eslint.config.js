// eslint.config.js
import js from "@eslint/js";
import globals from "globals";

export default [
  // Глобальные игноры
  { ignores: ["node_modules/**", "dist/**", "reports/**"] },

  js.configs.recommended,

  // Браузерный код
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
        YT: "readonly" // YouTube IFrame API
      }
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }]
      // "no-console": "off"
    }
  },

  // Конфиги/скрипты Node
  {
    files: ["vite.config.js", "*.cjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node, // даст process, __dirname и т.д.
        ...globals.es2021
      }
    },
    rules: {
      // хотим — оставляем строгий режим
      // "no-undef": "error"
    }
  }
];
