/**
 * Lint — `npm run lint`, and the first step of CI's checks.
 *
 * Deliberately small: the rules that catch a mistake, not a preference. The
 * linker (tools/build.js) already refuses what the module grammar does not
 * allow; this catches what it cannot see — a name used that nothing defines,
 * an import nothing reads (which still drags a module into a bundle, and an
 * edge into the graph the layering is checked against), dead code, a
 * duplicated key. Formatting is not linted.
 */
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['*.bundle.js', 'dist/**', 'dist-desktop/**', 'vendor/**', 'node_modules/**', 'src-tauri/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      // A handler's signature is the caller's, not ours: an unused leading
      // argument stays so the ones after it keep their places.
      // A rest pattern leaving fields out (`{ id, version, ...set }`) names
      // the ones it drops on purpose.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
  },
];
