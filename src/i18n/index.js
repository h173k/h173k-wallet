// ========== i18n CORE ==========
//
// Lightweight internationalization layer (no external dependencies).
//
//   import { useTranslation } from "./i18n"
//   const { t, language, setLanguage, languages } = useTranslation()
//   t("settings.title")              -> "Settings"
//   t("settings.decimalsSet", { n }) -> "Decimal places set to 4"
//
// The selected language is persisted in localStorage and restored on the
// next session automatically.

import { useCallback, useEffect, useState } from "react"
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "./languages"

// Keep the same naming convention as the rest of the app (h173k_* keys).
const LANGUAGE_STORAGE_KEY = "h173k_language"

// Build a quick lookup map: { code -> messages }
const MESSAGES = SUPPORTED_LANGUAGES.reduce((acc, lang) => {
  acc[lang.code] = lang.messages
  return acc
}, {})

const RTL_LANGUAGES = SUPPORTED_LANGUAGES
  .filter((l) => l.dir === "rtl")
  .map((l) => l.code)

function isSupported(code) {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code)
}

// ---------- persistence ----------
export function getStoredLanguage() {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored && isSupported(stored)) return stored
  } catch {
    /* ignore */
  }
  // Fall back to the browser language if we happen to support it.
  try {
    const nav = (navigator.language || "").slice(0, 2).toLowerCase()
    if (isSupported(nav)) return nav
  } catch {
    /* ignore */
  }
  return DEFAULT_LANGUAGE
}

function persistLanguage(code) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code)
  } catch {
    /* ignore */
  }
}

// ---------- reactive store ----------
let currentLanguage = getStoredLanguage()
const listeners = new Set()

function applyDocumentLanguage(code) {
  try {
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.lang = code
      document.documentElement.dir = RTL_LANGUAGES.includes(code) ? "rtl" : "ltr"
    }
  } catch {
    /* ignore */
  }
}

// Apply on first load so the <html> tag reflects the saved choice.
applyDocumentLanguage(currentLanguage)

export function getLanguage() {
  return currentLanguage
}

export function setLanguage(code) {
  if (!isSupported(code) || code === currentLanguage) {
    if (isSupported(code)) persistLanguage(code)
    return
  }
  currentLanguage = code
  persistLanguage(code)
  applyDocumentLanguage(code)
  listeners.forEach((fn) => {
    try {
      fn(code)
    } catch {
      /* ignore */
    }
  })
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ---------- translation lookup ----------
function lookup(messages, key) {
  if (!messages) return undefined
  return key.split(".").reduce((obj, part) => {
    if (obj && typeof obj === "object") return obj[part]
    return undefined
  }, messages)
}

function interpolate(str, vars) {
  if (!vars) return str
  return str.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  )
}

// Translate a dotted key for the given (or current) language.
// Falls back to the default language and finally to the key itself.
export function translate(key, vars, code = currentLanguage) {
  let value = lookup(MESSAGES[code], key)
  if (value === undefined && code !== DEFAULT_LANGUAGE) {
    value = lookup(MESSAGES[DEFAULT_LANGUAGE], key)
  }
  if (typeof value !== "string") return key
  return interpolate(value, vars)
}

// ---------- React hook ----------
export function useTranslation() {
  const [language, setLang] = useState(currentLanguage)

  useEffect(() => {
    // Sync in case the language changed before this component subscribed.
    setLang(currentLanguage)
    return subscribe((code) => setLang(code))
  }, [])

  const t = useCallback(
    (key, vars) => translate(key, vars, language),
    [language]
  )

  return {
    t,
    language,
    setLanguage,
    languages: SUPPORTED_LANGUAGES,
  }
}

export { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE }
