# Cleanup v1 (auto)

Что сделано:
- Удалены пустые импорты в `src/main.js` (footer.js, modal.js).
- В `src/css/styles.css` удалён пустой импорт `./modal.css`.
- Добавлены базовые конфиги линтеров: ESLint, Stylelint, PostCSS (cssnano).
- Сгенерированы отчёты:
  - `reports/unused_selectors.json` — потенциально неиспользуемые классы/ID (оценка, возможны ложные).
  - `reports/unreachable_js.json` — JS-файлы вне импорт-графа (могут быть задействованы динамически).
  - `reports/zero_size_files.txt` — файлы нулевого размера.

**Примечание:** Никакие стили/модули не удалялись физически (кроме импорт-строк) — чтобы не сломать поведение. Для физического удаления рекомендуем пройтись по отчётам и удалить вручную или доверить ассистенту следующий шаг ("Cleanup v2 — безопасное удаление").

Изменения:
- src/main.js: removed imports of zero-size files (footer.js, modal.js)
- src/css/styles.css: removed empty @import './modal.css'
- eslint.config.js: added basic ESLint flat config
- stylelint.config.cjs: added Stylelint config
- postcss.config.cjs: added CSS minify/duplicate removal
- jsconfig.json: added to enable //@ts-check and better IDE hints
