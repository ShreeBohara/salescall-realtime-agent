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
    // AI-tool scaffolding. Throwaway git worktrees land here holding a full
    // second copy of the source tree pinned to an older commit, so eslint
    // double-counts every file and reports errors already fixed on main.
    // Gitignored, but flat config doesn't read .gitignore.
    ".claude/**",
  ]),
]);

export default eslintConfig;
