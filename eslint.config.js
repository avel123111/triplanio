import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";

// Type-scale gate: ALL inline font sizes must use a --fs-* token, never a raw
// number. Both ranges (<16 body, >=16 display) are fully tokenized.
const FONT_SIZE_SELECTORS = [
  {
    selector: "Property[key.name='fontSize'] > Literal[value<16]",
    message: "Inline fontSize must use a --fs-* token (e.g. fontSize: 'var(--fs-base)'), not a raw number.",
  },
  {
    selector: "Property[key.name='fontSize'] > Literal[value>=16]",
    message: "Inline fontSize must use a --fs-display token (--fs-lg/xl/h2/2xl/3xl/h1/hero), not a raw number.",
  },
];

// TRIP-66 write-contract gate (anti-erosion ratchet). A raw
// `supabase.from(...).insert|update|delete|upsert(...)` swallows both a real
// { error } and a silent 0-row RLS reject unless its result is read. All
// content writes must go through the data-access layer (writeRows in
// src/lib/trip-data.js / src/lib/documentMutations.js — src/lib is not linted).
// New code is blocked immediately; the files listed in RAW_WRITE_ALLOWLIST below
// are grandfathered (that list IS the migration checklist — shrink it, never grow).
const RAW_SUPABASE_WRITE = {
  selector:
    "CallExpression[callee.property.name=/^(insert|update|delete|upsert)$/][callee.object.callee.property.name='from'][callee.object.callee.object.name='supabase']",
  message:
    "Raw supabase.from().insert/update/delete/upsert swallows errors and silent 0-row RLS rejects. Route the write through the data-access layer (writeRows / a *Mutations helper in src/lib), or add this file to RAW_WRITE_ALLOWLIST in eslint.config.js if it's an intentional carve-out.",
};

// Files that still construct a raw builder at the call site. Categories:
//   - writeRows-wrapped (contract already satisfied; builder pending move to layer)
//   - already-safe raw (.select().single() chat insert; idempotent mark-read)
//   - billing/auth carve-out (rule 13 — migrates in a separate security-review PR)
const RAW_WRITE_ALLOWLIST = [
  // writeRows-wrapped, builder still at call site
  "src/pages/BudgetLens.jsx",
  "src/pages/ManualPlanner.jsx",
  "src/pages/SettingsLens.jsx",
  "src/components/common/EventEditDialog.jsx",
  "src/components/stats/AddPlaceDialog.jsx",
  // already-safe raw (single()/idempotent mark-read)
  "src/pages/ChatLens.jsx",
  "src/pages/Inbox.jsx",
  "src/components/chat/ChatWidget.jsx",
  "src/components/notifications/NotificationsBell.jsx",
  // billing/auth carve-out (rule 13)
  "src/pages/ScreenAccount.jsx",
];

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
      // Numeric fontSize comparisons only match number literals, so string
      // values like 'var(--fs-base)' or '90%' are unaffected.
      "no-restricted-syntax": ["error", ...FONT_SIZE_SELECTORS, RAW_SUPABASE_WRITE],
    },
  },
  // Grandfathered files: keep the type-scale gate, drop the raw-write gate.
  {
    files: RAW_WRITE_ALLOWLIST,
    rules: {
      "no-restricted-syntax": ["error", ...FONT_SIZE_SELECTORS],
    },
  },
];
