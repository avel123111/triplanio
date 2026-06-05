import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";

export default [
  {
    files: [
      "src/components/**/*.{js,mjs,cjs,jsx}",
      "src/pages/**/*.{js,mjs,cjs,jsx}",
      "src/Layout.jsx",
    ],
    ignores: ["src/lib/**/*", "src/components/ui/**/*"],
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      "no-unused-vars": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["cmdk-input-wrapper", "toast-close"] },
      ],
      "react-hooks/rules-of-hooks": "error",
      // Type-scale gate: ALL inline font sizes must use a --fs-* token, never a
      // raw number. Body range (<16) and display range (>=16, headings/stats) are
      // both fully tokenized — this keeps the whole type scale from drifting back.
      // Numeric comparisons only match number literals, so string values like
      // 'var(--fs-base)' or '90%' are unaffected.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Property[key.name='fontSize'] > Literal[value<16]",
          message: "Inline fontSize must use a --fs-* token (e.g. fontSize: 'var(--fs-base)'), not a raw number.",
        },
        {
          selector: "Property[key.name='fontSize'] > Literal[value>=16]",
          message: "Inline fontSize must use a --fs-display token (--fs-lg/xl/h2/2xl/3xl/h1/hero), not a raw number.",
        },
      ],
    },
  },
];
