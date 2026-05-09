import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Keep lint usable in this repo (many scripts and some app code intentionally use `any` / CJS).
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "prefer-const": "off",
      // These rules are too strict for the current codebase and were not previously enforced.
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react/no-unescaped-entities": "off",
    },
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Non-app tooling / external runtimes (Apps Script, one-off scripts)
      "scripts/**",
      "google-sheets-addon/**",
      "prisma/**",
    ],
  },
];

export default eslintConfig;
