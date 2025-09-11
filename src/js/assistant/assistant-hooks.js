// assistant-hooks.js
// Пример внешнего препроцессора (опционально)
(() => {
  if (!window.Assistant) return;
  // Пример: исправить частую оговорку
  window.Assistant.preprocessText = (text) => {
    const fixed = String(text).replace(/пауза на паузу/i, "пауза");
    return fixed;
  };
  // Пример: программно отправить команду снаружи:
  // window.Assistant.enqueueText("включи mix radio");
})();
