// Security-focused lint. Run: npm run lint:security
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import nounsanitized from 'eslint-plugin-no-unsanitized';

export default defineConfig(
  { ignores: ['dist/**', '.astro/**', '.wrangler/**', 'node_modules/**', 'wordpress-plugin/**'] },
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.mjs'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { security, 'no-unsanitized': nounsanitized },
    rules: {
      ...security.configs.recommended.rules,
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      // Reviewed manually: every flagged lookup indexes a typed constant map or a
      // key that was validated first (see SECURITY.md). Too noisy to gate on.
      'security/detect-object-injection': 'off',
    },
  },
  {
    // Build/maintenance scripts read fixed project paths only.
    files: ['scripts/**/*.mjs'],
    rules: { 'security/detect-non-literal-fs-filename': 'off' },
  },
  {
    // The security tests deliberately contain attack payloads (javascript: URLs)
    // and import their own freshly built bundle.
    files: ['scripts/test-security.mjs'],
    rules: { 'no-script-url': 'off', 'no-unsanitized/method': 'off' },
  },
);
