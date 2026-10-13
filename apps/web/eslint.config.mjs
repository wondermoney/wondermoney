import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";

const config = [
  {
    ignores: ["node_modules/", ".next/", "out/", ".github/", "public/", "scripts/", "next-env.d.ts"],
  },
  ...nextCoreWebVitals,
  prettier,
  {
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      // React Compiler rules that eslint-config-next 16 turned on. They flag patterns the app
      // already uses (about 70 places); adopting them is its own piece of work, not part of
      // the Next 16 upgrade.
      "react-hooks/error-boundaries": "off",
      "react-hooks/immutability": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    },
  },
];

export default config;
