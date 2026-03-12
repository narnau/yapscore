import { dirname } from "path";
import { fileURLToPath } from "url";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextConfig from "eslint-config-next";
import eslintConfigPrettier from "eslint-config-prettier";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: [".next/", "node_modules/", "coverage/", "dist/", "package/", "next-env.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextConfig.map((config) => ({
    ...config,
    settings: {
      ...config.settings,
      next: { rootDir: __dirname },
    },
  })),
  eslintConfigPrettier,
  {
    rules: {
      // Allow console.log — project uses intentional tagged logging
      "no-console": "off",
      // Warn on unused vars, but allow underscore-prefixed ones
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Allow explicit `any` with a warning (too many existing uses to error)
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow empty interfaces/types (useful for extending)
      "@typescript-eslint/no-empty-object-type": "off",
      // Allow non-null assertions (common in Next.js patterns)
      "@typescript-eslint/no-non-null-assertion": "off",
      // Allow require imports (needed for some Node.js patterns)
      "@typescript-eslint/no-require-imports": "off",
      // Allow @ts-ignore (existing codebase uses it)
      "@typescript-eslint/ban-ts-comment": "off",
      // Allow unescaped entities in JSX (too many existing uses)
      "react/no-unescaped-entities": "off",
      // Downgrade Function type usage to warning
      "@typescript-eslint/no-unsafe-function-type": "warn",
      // Downgrade refs-during-render to warning (React 19 compiler rule, many false positives)
      "react-hooks/refs": "warn",
    },
  },
);
