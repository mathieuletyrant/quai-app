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
  {
    files: ["**/*.{ts,tsx}"],
    // A function a reader takes in at once: few branches, shallow, few parameters.
    rules: {
      complexity: ["error", 15],
      "max-depth": ["error", 3],
      "max-params": ["error", 4],
      "max-nested-callbacks": ["error", 5]
    }
  },
  {
    files: ["apps/cloud/src/**/*.ts", "apps/home/src/**/*.ts", "packages/api/src/**/*.ts"],
    // AGENTS.md, Effect: everything is an Effect, errors are tagged, time goes through Clock.
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "Time goes through Clock (Clock.currentTimeMillis), so TestClock moves it."
        },
        { selector: "ThrowStatement", message: "Fail with a Data.TaggedError (Effect.fail), never throw." },
        { selector: ":function[async=true]", message: "No async on the server: write an Effect." },
        { selector: "NewExpression[callee.name='Promise']", message: "No Promise on the server: write an Effect." },
        {
          selector: "CallExpression[callee.property.name='then']",
          message: "No Promise on the server: write an Effect."
        }
      ]
    }
  },
  {
    files: ["apps/console/src/**/*.tsx"],
    // AGENTS.md, Console: theme tokens only, no arbitrary colour, type size or radius.
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/\\[#[0-9a-fA-F]{3,8}\\]|text-\\[\\d+px\\]|rounded-\\[\\d+px\\]/]",
          message: "Use a theme token from styles.css (add one if needed), not an arbitrary value."
        },
        {
          selector: "TemplateElement[value.raw=/\\[#[0-9a-fA-F]{3,8}\\]|text-\\[\\d+px\\]|rounded-\\[\\d+px\\]/]",
          message: "Use a theme token from styles.css (add one if needed), not an arbitrary value."
        }
      ]
    }
  },
  { files: [".github/**/*.mjs"], languageOptions: { globals: globals.node } },
  {
    files: ["apps/console/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules
  }
)
