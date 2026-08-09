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
  // ── Correctness gate for ALL production JS/JSX ──────────────────────────
  // The design-system gates below (font-scale, raw-write) belong only to
  // components/ + pages/, so that block is scoped narrowly and even `ignores`
  // src/lib and src/components/ui. But an UNDEFINED IDENTIFIER — a bare
  // reference or a JSX component used-but-not-imported — is a runtime
  // ReferenceError in ANY directory, and the narrow scope left src/App.jsx,
  // src/design/** (where the design system itself lives), src/lib/**, and all
  // of src/components/ui/** completely unchecked. That is how a migrated
  // <IconBtn> shipped a crash on the event modal: it lints clean, typechecks
  // clean without `// @ts-check`, builds clean (Vite doesn't resolve names),
  // and fails only at runtime (TRIP-344 PR 2, caught by Sentry not the gate).
  // This block carries ONLY the two correctness rules, repo-wide — no
  // design-system gate leaks into the design system or the vendored ui/.
  // Proven by linting an undefined <Missing/> under App.jsx, design/, lib/,
  // and components/ui/: each fails here, all four passed before.
  {
    files: ["src/**/*.{js,mjs,cjs,jsx}"],
    languageOptions: {
      // browser only, exactly like the main block below — src is browser code
      // (Vite uses import.meta.env, not process). Adding node globals here would
      // loosen no-undef for components, masking a `process.env` that crashes in
      // the browser — the very class this block exists to catch.
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: "detect" } },
    // react-hooks is registered but NOT enabled here: src/lib and
    // src/components/ui were never linted before, so their existing
    // `// eslint-disable react-hooks/exhaustive-deps` directives would now
    // error as "rule not found" the moment this block starts linting them.
    // Registering the plugin resolves the directive without turning the rule on.
    plugins: { react: pluginReact, "react-hooks": pluginReactHooks },
    rules: {
      "no-undef": "error",
      "react/jsx-no-undef": "error",
    },
  },
  // The correctness block above is browser-only — right for app code (Vite),
  // wrong for the src test files, which `package.json` runs with `node --test`
  // and which legitimately use Node globals (`process`, `Buffer`, …). Without
  // this a test calling `process.cwd()` fails `no-undef`. Placed after that
  // block so its Node globals merge on top for test files ONLY; app code keeps
  // browser-only, so a `process.env` shipped to the browser is still caught.
  {
    files: ["src/**/*.test.{js,mjs,cjs,jsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
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
      // Spelled out because THIS `rules` key replaces the one spread in from
      // pluginJs.configs.recommended above, so nothing from `recommended`
      // actually reaches these files. Without it, code that references an
      // identifier it never imported lints clean and only fails at runtime as a
      // ReferenceError — how a booking/map action shipped dead (TRIP-277).
      // Enabling it costs nothing: zero violations across the linted tree.
      "no-undef": "error",
      // ⚠ `no-undef` above catches a bare identifier (`foo()`, a const) that was
      // never imported — but NOT an undefined JSX COMPONENT. `<IconBtn>` parses as
      // a JSXIdentifier, which no-undef's scope analysis does not treat as an
      // undefined reference; only `react/jsx-no-undef` does. Without it a component
      // used-but-not-imported lints clean, typechecks clean when the file lacks
      // `// @ts-check`, builds clean (Vite/esbuild don't resolve identifiers), and
      // fails only at runtime as `ReferenceError: X is not defined` — exactly how a
      // migrated <IconBtn> shipped a crash on the event modal (TRIP-344 PR 2). The
      // two rules cover disjoint halves; both are needed.
      "react/jsx-no-undef": "error",
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
