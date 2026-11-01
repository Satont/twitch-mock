import { defineConfig } from 'oxlint';

// Structural rules apply to handwritten code. The stricter anti-slop type-policy
// rules are intentionally omitted: Twitch payloads cross heterogeneous JSON boundaries.
export default defineConfig({
  plugins: ['typescript', 'unicorn', 'oxc', 'react', 'jsx-a11y'],
  categories: { correctness: 'error' },
  ignorePatterns: ['dist/**', 'node_modules/**', '.impeccable/**', 'tools/oxlint/anti-slop/**'],
  jsPlugins: [{ name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' }],
  rules: {
    'oxc/no-accumulating-spread': 'error',
    'anti-slop/no-array-filter-map': 'error',
    'anti-slop/no-reduce-accumulator-copy': 'error',
    'anti-slop/no-chained-type-assertions': 'error',
    'anti-slop/no-module-mocking': 'error',
    'anti-slop/no-reflect-apply': 'error',
    'anti-slop/no-reflect-get': 'error',
    'anti-slop/no-widen-then-assert': 'error',
    'anti-slop/require-readable-spacing': 'error',
  },
});
