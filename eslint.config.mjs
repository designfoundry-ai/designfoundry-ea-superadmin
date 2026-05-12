import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Code worktrees live under .claude/worktrees/*/ and each carries its
    // own .next/ build output + node_modules. eslint-config-next's default
    // ignore covers ".next/**" only at the project root, so lint walks the
    // nested build outputs and reports thousands of false positives against
    // minified webpack chunks. Add a broad ignore for the whole .claude/ tree.
    ".claude/**",
  ]),
  // Node CLI scripts under scripts/*.js use CommonJS require() idiomatically.
  // (package.json has no `"type": "module"`, so .js defaults to CommonJS;
  // rewriting these as ESM would force a rename to .mjs across the deploy/
  // shell tooling that invokes them.) Narrow the require-imports rule
  // off for that single directory.
  {
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // React Compiler's `react-hooks/set-state-in-effect` rule flags every
  // useEffect that synchronously calls setState before its first await
  // (e.g. `setLoading(true); await fetch(...); setData(...)`). It's a
  // valid perf nudge — React schedules an extra render before the data
  // arrives — but for admin pages with single-digit concurrent users
  // the impact is academic. Fixing each call site cleanly requires
  // either useTransition wrappers or a migration to TanStack Query /
  // SWR; both are real architectural decisions, not lint cleanup. Demote
  // to warn so the signal is preserved in the lint output without
  // gating CI. Revisit when there's appetite for the data-fetching
  // library migration (tracked as a future follow-up).
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
