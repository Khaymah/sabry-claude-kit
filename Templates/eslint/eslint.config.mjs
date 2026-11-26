import tseslint from "typescript-eslint"
import regexp from "eslint-plugin-regexp"
import drizzle from "eslint-plugin-drizzle"

const DB_OBJECTS = ["db", "Db", "tx", "Tx", "trx"]

export default tseslint.config(
  { ignores: ["dist/**", "build/**", ".next/**", "node_modules/**", "**/Migrations/**", "**/migrations/**", "**/*.d.ts"] },
  ...tseslint.configs.recommended,
  regexp.configs["flat/recommended"],
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: { parserOptions: { projectService: true } },
    plugins: { drizzle },
    rules: {
      "drizzle/enforce-delete-with-where": ["error", { drizzleObjectName: DB_OBJECTS }],
      "drizzle/enforce-update-with-where": ["error", { drizzleObjectName: DB_OBJECTS }],
      "no-await-in-loop": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "regexp/no-super-linear-backtracking": "error",
      "no-console": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.property.name='forEach'] > :function[async=true]", message: "forEach never awaits: use for...of or Promise.all with a limit." },
        { selector: "CallExpression[callee.property.name=/^(hashSync|compareSync|pbkdf2Sync|scryptSync|execSync|spawnSync|readFileSync|writeFileSync)$/], CallExpression[callee.name=/^(pbkdf2Sync|scryptSync|execSync|spawnSync|readFileSync|writeFileSync)$/]", message: "Sync I/O or crypto blocks every request: use the async API." },
        { selector: "CallExpression[callee.property.name='from'][callee.object.callee.property.name='select'][callee.object.arguments.length=0]", message: "select() reads every column: select the fields you return." },
        { selector: "CallExpression[callee.name='parseFloat']", message: "No float parsing on money or ids: ToMinor() for amounts, Number.parseInt or z.coerce for integers." },
      ],
      "max-lines": ["error", { max: 600, skipBlankLines: true }],
      "max-lines-per-function": ["warn", { max: 50, skipBlankLines: true }],
      "max-depth": ["error", 3],
      "max-params": ["error", 4],
      complexity: ["error", 10],
    },
  },
  {
    files: ["**/*.{test,spec}.{ts,tsx}", "**/Test/**", "**/tests/**", "scripts/**", "**/Seeds/**", "**/seeds/**"],
    rules: {
      "no-console": "off",
      "no-await-in-loop": "off",
      "no-restricted-syntax": "off",
      "max-lines-per-function": "off",
      "max-lines": "off",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
)
