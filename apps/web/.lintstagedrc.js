// lint-staged hands over absolute paths and runs from this package, so eslint resolves this
// package's config. Ignored files (next-env.d.ts, scripts/) are skipped without a warning.
const buildEslintCommand = (filenames) =>
  `eslint --max-warnings=0 --no-warn-ignored ${filenames.map((file) => JSON.stringify(file)).join(" ")}`;

module.exports = {
  "*.{js,jsx,ts,tsx}": [buildEslintCommand],
};
