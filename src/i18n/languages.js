// ========== SUPPORTED LANGUAGES REGISTRY ==========
//
// To add a new language:
//   1. Create a new locale file in ./locales/<code>.js (copy ./locales/en.js
//      and translate the values). Keep the same key structure.
//   2. Import it below and add a single entry to the SUPPORTED_LANGUAGES array.
//
// `nativeName` is what users see in the language picker.
// `dir` is optional and defaults to "ltr"; set it to "rtl" for
// right-to-left languages.

import en from "./locales/en"
import pl from "./locales/pl"
import es from "./locales/es"
import fr from "./locales/fr"
import de from "./locales/de"
import am from "./locales/am"

export const SUPPORTED_LANGUAGES = [
  { code: "en", nativeName: "English", messages: en },
  { code: "pl", nativeName: "Polski", messages: pl },
  { code: "es", nativeName: "Español", messages: es },
  { code: "fr", nativeName: "Français", messages: fr },
  { code: "de", nativeName: "Deutsch", messages: de },
  { code: "am", nativeName: "አማርኛ", messages: am },
]

export const DEFAULT_LANGUAGE = "en"
