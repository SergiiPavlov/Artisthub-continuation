// postcss.config.cjs
// Флаги (ставь через cross-env в npm-скриптах):
//   NO_MQ_SORT=1     — отключить сортировку медиазапросов
//   MEDIA_SORT=desktop-first | mobile-first (по умолчанию mobile-first)
//   NO_MINIFY=1      — отключить минификацию (cssnano)

function safeRequire(name) {
  try { return require(name); } catch { return null; }
}

const plugins = [];

// 1) Сортировка медиазапросов (может влиять на каскад)
if (process.env.NO_MQ_SORT !== '1') {
  const sortMq = safeRequire('postcss-sort-media-queries');
  if (sortMq) {
    const mode = (process.env.MEDIA_SORT || 'mobile-first').toLowerCase();
    plugins.push(sortMq({ sort: mode }));
  }
}

// 2) Удаление дублей
const discardDuplicates = safeRequire('postcss-discard-duplicates');
if (discardDuplicates) plugins.push(discardDuplicates);

// 3) Autoprefixer (не обязателен; подключится, только если установлен)
const autoprefixer = safeRequire('autoprefixer');
if (autoprefixer) plugins.push(autoprefixer());

// 4) Минификация
if (process.env.NO_MINIFY !== '1') {
  const cssnano = safeRequire('cssnano');
  if (cssnano) plugins.push(cssnano({ preset: 'default' }));
}

module.exports = { plugins };
