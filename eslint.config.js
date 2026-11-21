import tseslint from "typescript-eslint";
export default [
  { ignores:["dist/**","release/**"] },
  ...tseslint.configs.recommended,
  { files:["desktop/**/*.cjs"], rules:{ "@typescript-eslint/no-require-imports":"off" } },
];