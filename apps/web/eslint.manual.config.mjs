import { defineConfig, globalIgnores } from "eslint/config";
import tsParser from "@typescript-eslint/parser";
import tsEslint from "@typescript-eslint/eslint-plugin";
import drizzle from "eslint-plugin-drizzle";
import reactCompiler from "eslint-plugin-react-compiler";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "@typescript-eslint": tsEslint,
      drizzle,
      "react-compiler": reactCompiler,
    },
    rules: {
      "drizzle/enforce-delete-with-where": "error",
      "drizzle/enforce-update-with-where": "error",
      "react-compiler/react-compiler": "error",
    },
  },
  globalIgnores([
    "dist/**",
    ".tanstack/**",
    ".output/**",
    "out/**",
    "build/**",
    "coverage/**",
    "src/routeTree.gen.ts",
  ]),
]);
