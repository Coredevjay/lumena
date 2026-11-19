import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";
import lumenSecurity from "./scripts/linter/index.js";

export default [
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      lumen: lumenSecurity,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "lumen/no-unsafe-xdr": "error",
      "lumen/no-raw-secret-keys": "error",
    },
  },
  {
    files: [
      "packages/core/**/*.ts",
      "packages/web-sdk/**/*.ts",
      "packages/react/**/*.ts",
      "packages/react-native/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node:crypto",
              message:
                "Do not import 'node:crypto' directly in browser-targeted modules. Use the crypto adapter (Web Crypto first) instead. See issue #532.",
            },
            {
              name: "crypto",
              message:
                "Do not import 'crypto' directly in browser-targeted modules. Use the crypto adapter (Web Crypto first) instead. See issue #532.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "packages/core/src/crypto/**/*.ts",
      "packages/core/src/crypto-adapter/**/*.ts",
      "packages/web-sdk/src/crypto/**/*.ts",
      "packages/react/src/crypto/**/*.ts",
      "packages/react-native/src/crypto/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  prettierConfig,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.js"],
  },
];