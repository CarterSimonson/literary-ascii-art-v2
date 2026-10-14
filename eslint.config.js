import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "node_modules/**",
      "output/**",
      "coverage/**",
      ".artifacts/**",
      ".worktrees/**",
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
    rules: {
      "array-callback-return": ["error", { checkForEach: true }],
      curly: ["error", "all"],
      "max-depth": ["error", 4],
      "no-else-return": ["error", { allowElseIf: false }],
      "no-implicit-coercion": "error",
      "no-lonely-if": "error",
      "no-multi-assign": "error",
      "no-nested-ternary": "error",
      "no-param-reassign": "error",
      "no-sequences": ["error", { allowInParentheses: false }],
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      eqeqeq: ["error", "always"],
    },
  },
];
