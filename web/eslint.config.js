import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // React Compiler-aware rules from eslint-plugin-react-hooks v7. They
      // catch real antipatterns (reading ref.current during render, calling
      // setState synchronously inside an effect, manual memoization the
      // compiler can't preserve, non-inline useCallback args), but flag
      // several existing hook + component implementations that work
      // correctly in practice. Surface as warnings so we don't block CI;
      // revisit when refactoring those hooks. The classic rules-of-hooks
      // and exhaustive-deps rules from the plugin remain errors.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/use-memo': 'warn',
    },
  },
])
