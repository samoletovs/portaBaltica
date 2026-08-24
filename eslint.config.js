import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Git worktrees are checked out under these paths during parallel work. Each
  // carries its own tsconfig, and typescript-eslint refuses to guess between
  // them: with a worktree present, every rule that needs type information
  // fails to parse and lint reports hundreds of phantom errors across files
  // nobody touched. Ignoring the checkouts and pinning the root below makes
  // the result depend only on the working tree being linted.
  globalIgnores(['dist', '.worktrees', '**/.worktrees/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
])
