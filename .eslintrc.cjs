/**
 * Minimal lint config. The goal is not style enforcement but catching the one
 * class of bug that survives a successful build: an identifier that is used but
 * never imported or declared. JavaScript only fails on those at runtime, and
 * only on the code path that touches them, so a clean `npm run build` proves
 * nothing about them.
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true, serviceworker: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  globals: { Buffer: 'readonly', process: 'readonly', globalThis: 'readonly' },
  plugins: ['react', 'react-hooks'],
  settings: { react: { version: 'detect' } },
  rules: {
    'no-undef': 'error',
    'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
    // without these two, anything used only inside JSX looks unused
    'react/jsx-uses-vars': 'error',
    'react/jsx-uses-react': 'error',
    'react-hooks/rules-of-hooks': 'error',
  },
}
