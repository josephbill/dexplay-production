import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'
import { reportTranslations } from './i18n/reportTranslations'

export type Language = 'en'|'es'|'hi'|'zh'|'ar'|'sw'|'pt'|'fr'|'bn'|'tl'
export type Dictionary = Record<string, string>
type I18nValue = { language: Language; dict: Dictionary }
const modules = import.meta.glob('./i18n/*.json', { eager: true, import: 'default' }) as Record<string, Dictionary>
const I18nContext = createContext<I18nValue | null>(null)

export const languages: {code:Language,label:string}[] = [
  {code:'en',label:'English'}, {code:'es',label:'Español'}, {code:'hi',label:'हिन्दी'}, {code:'zh',label:'中文'},
  {code:'ar',label:'العربية'}, {code:'sw',label:'Kiswahili'}, {code:'pt',label:'Português'}, {code:'fr',label:'Français'},
  {code:'bn',label:'বাংলা'}, {code:'tl',label:'Filipino'},
]
export function detectLanguage(): Language {
  const stored = localStorage.getItem('dexplay.language') as Language | null
  if (stored && languages.some(item => item.code === stored)) return stored
  return 'en'
}
export function dictionary(language: Language): Dictionary {
  const catalog = modules[`./i18n/${language}.json`] || modules['./i18n/en.json']
  return { ...catalog, ...reportTranslations[language] }
}

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const dict = useMemo(() => dictionary(language), [language])
  const value = useMemo(() => ({ language, dict }), [language, dict])
  return createElement(I18nContext.Provider, { value }, children)
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value)
    throw new Error('useI18n must be used inside I18nProvider')
  return value
}

export function t(dict: Dictionary, key: string, values: Record<string,string|number> = {}): string {
  let text = dict[key] ?? modules['./i18n/en.json'][key] ?? key
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value))
  return text
}
