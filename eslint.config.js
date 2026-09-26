import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config.
 *
 * The engine (`src/lib/**`) is pure TypeScript and runs both in the browser and
 * under `node --test`, so it gets the Node globals; components get the browser
 * globals. Type-aware rules are deliberately left off: they need a project
 * service and would slow the CI lint step down for little gain here.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.probe/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Tests assert on internals and build deliberately malformed fixtures.
    files: ['**/*.test.{ts,tsx}', 'src/lib/testUtils.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
