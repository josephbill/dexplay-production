export type Language = 'en'|'es'|'hi'|'zh'|'ar'|'sw'|'pt'|'fr'|'bn'|'tl'
export type Dictionary = Record<string, string>
const modules = import.meta.glob('./i18n/*.json', { eager: true, import: 'default' }) as Record<string, Dictionary>
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
  return modules[`./i18n/${language}.json`] || modules['./i18n/en.json']
}
export function t(dict: Dictionary, key: string, values: Record<string,string|number> = {}): string {
  let text = dict[key] ?? modules['./i18n/en.json'][key] ?? key
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value))
  return text
}
