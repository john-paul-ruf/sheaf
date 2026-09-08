import tseslint from "typescript-eslint";

const FORBIDDEN_SYNTAX = [
  {
    selector: "CallExpression[callee.name='eval']",
    message: "eval is forbidden: no imported or authored behavior executes.",
  },
  {
    selector: "NewExpression[callee.name='Function']",
    message:
      "new Function is forbidden: no imported or authored behavior executes.",
  },
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: "dangerouslySetInnerHTML is forbidden: user data is never HTML.",
  },
  {
    selector: "Property[key.name='dangerouslySetInnerHTML']",
    message: "dangerouslySetInnerHTML is forbidden: user data is never HTML.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-restricted-syntax": ["error", ...FORBIDDEN_SYNTAX],
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
