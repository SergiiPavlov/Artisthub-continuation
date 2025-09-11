// alias of assistant-hooks.js
(() => {
  const W = (window.Assistant = window.Assistant || {});

  function normalizeDashes(s) {
    return String(s || "").replace(/[–—]/g, "-");
  }
  function normalizeTimingPhrases(s0) {
    let s = normalizeDashes(String(s0 || "")).toLowerCase();
    s = s.replace(/через\s+пол ?минут[ыи]/g, "через 30 секунд");
    s = s.replace(/через\s+пол ?часа/g, "через 30 минут");
    s = s.replace(/через\s+минут[уы]/g, "через 1 минуту");
    s = s.replace(/через\s+секунд[уы]/g, "через 1 секунду");
    s = s.replace(/через\s+час[ау]?/g, "через 1 час");
    s = s.replace(/через\s+(\d{1,3})\s*-\s*(\d{1,3})\s*(секунд\w*|минут\w*|час\w*|s|m|h|min|sec|hour|minutes?)/g,
      (_m, a, b, u) => `через ${b} ${u}`);
    s = s.replace(
      /через\s+(\d{1,3}(?:\s*,\s*\d{1,3})+)\s*(секунд\w*|минут\w*|час\w*|s|m|h|min|sec|hour|minutes?)/g,
      (_m, list, u) => {
        const parts = list.split(/\s*,\s*/).map(Number).filter((n) => Number.isFinite(n));
        const last = parts[parts.length - 1] || 0;
        return `через ${last} ${u}`;
      }
    );
    s = s.replace(/секундочк[ауи]/g, "секунду").replace(/минутк[ауи]/g, "минуту");
    return s0 && s !== s0 ? s : s0;
  }

  W.preprocessText = function (text) {
    const t1 = normalizeTimingPhrases(text);
    return t1;
  };
})();
