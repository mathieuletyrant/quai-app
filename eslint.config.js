import effect from "@effect/eslint-plugin"
import js from "@eslint/js"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"
import tseslint from "typescript-eslint"

// typescript-eslint parses with the root's TypeScript 5 (`typescript` in the root package.json): the packages build
// with TypeScript 7, which has no JavaScript API.
export default tseslint.config(
  { ignores: ["**/node_modules/", "**/dist/", "apps/ios/", "apps/site/public/", "**/*.json"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js}"],
    plugins: { "@effect": effect },
    rules: {
      "@effect/dprint": ["error", {
        config: {
          indentWidth: 2,
          lineWidth: 120,
          semiColons: "asi",
          quoteStyle: "alwaysDouble",
          trailingCommas: "never",
          operatorPosition: "maintain",
          "arrowFunction.useParentheses": "force"
        }
      }],
      // AGENTS.md, Code: names say what a value is. Uppercase type parameters (`<A, E>`) aren't checked.
      "id-length": ["error", { min: 2, exceptions: ["_"], properties: "never" }],
      // A leading underscore marks a value left out on purpose (`const { detail: _, ...rest } = alert`).
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true
      }]
    }
  },
  {
    files: ["**/test/**", "**/*.test.{ts,tsx}"],
    // Fakes hold what the code under test sent, whatever its shape.
    rules: { "@typescript-eslint/no-explicit-any": "off" }
  },
  { files: [".github/**/*.mjs"], languageOptions: { globals: globals.node } },
  {
    files: ["apps/console/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules
  }
)
