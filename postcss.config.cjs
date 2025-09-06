module.exports = { plugins: [require('postcss-discard-duplicates'), require('cssnano')({ preset: 'default' })] };
module.exports = {
  plugins: [
    require('postcss-sort-media-queries')({ sort: 'mobile-first' }),
    require('postcss-discard-duplicates'),
    require('cssnano')({ preset: 'default' }),
  ],
};
