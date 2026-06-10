# i18n — Internationalization

Lightweight, dependency-free translation layer for the H173K Wallet.

## Structure

```
src/i18n/
├── index.js          Core: persistence, t(), useTranslation() hook
├── languages.js      Registry of supported languages
└── locales/
    ├── en.js         English (base / fallback)
    ├── pl.js         Polish
    ├── es.js         Spanish
    ├── fr.js         French
    ├── de.js         German
    └── am.js         Amharic
```

## Usage in components

```jsx
import { useTranslation } from './i18n'

function MyComponent() {
  const { t, language, setLanguage, languages } = useTranslation()
  return <h2>{t('settings.title')}</h2>
}
```

- `t(key, vars)` — translate a dotted key. Supports `{name}` placeholders, e.g.
  `t('settings.decimalsSet', { n: 4 })`.
- Missing keys fall back to the base language (`en`) and then to the key itself.
- The chosen language is stored in `localStorage` under `h173k_language` and is
  restored automatically on the next session.

## Adding a new language

1. Copy `locales/en.js` to `locales/<code>.js` and translate the values
   (keep the key structure identical).
2. In `languages.js`, import the new file and add one entry to
   `SUPPORTED_LANGUAGES`:

   ```js
   import it from './locales/it'
   // ...
   { code: 'it', nativeName: 'Italiano', messages: it },
   ```

That's it — the new language appears automatically in the Settings language
list. For right-to-left languages add `dir: 'rtl'` to the registry entry.
