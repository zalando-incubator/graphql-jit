import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierPlugin from "eslint-plugin-prettier/recommended";

export default tseslint.config(
  {
    ignores: [
      ".stryker-tmp/",
      ".tsup/",
      ".vscode",
      "dist/",
      "examples/",
      "node_modules/",
      "scripts/"
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-console": "error",
      "no-throw-literal": "error",
      "no-new-func": "error",
      "no-self-compare": "error",
      "no-useless-call": "error",
      "no-sequences": "error",
      "no-template-curly-in-string": "error",
      "@typescript-eslint/no-empty-function": "error",
      "@typescript-eslint/no-non-null-assertion": "error",

      "@typescript-eslint/no-unused-vars": "warn",

      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  {
    files: ["**/__benchmarks__/**", "**/__tests__/**"],
    rules: {
      "no-console": "off"
    }
  },
  prettierPlugin
);
