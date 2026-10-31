/**
 * Infrastructure for the app-shell specs: the shipped translation catalogs
 * and small readers of what the network guard refused. Nothing here drives
 * the UI. (A signed-in MuulOrigin account is the shared mock in
 * fixtures/account.ts + helpers/mocks/muulAccount.ts.)
 *
 * Catalogs are read straight from src/i18n/locales/<code>.json, the files the
 * build ships, so a language assertion compares the screen with the real
 * translation instead of a copy that could drift.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { LocaleCode } from '../data/shell-files.js'

type CatalogValue = string | Partial<Record<'zero' | 'one' | 'two' | 'few' | 'many' | 'other', string>>
const LOCALE_DIR = path.resolve(import.meta.dirname, '..', '..', 'src', 'i18n', 'locales')
const cache = new Map<LocaleCode, Record<string, CatalogValue>>()

export function catalog(code: LocaleCode): Record<string, CatalogValue> {
  if (code === 'en') return {}
  let c = cache.get(code)
  if (!c) {
    c = JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, `${code}.json`), 'utf8')) as Record<string, CatalogValue>
    cache.set(code, c)
  }
  return c
}

/**
 * What the app renders for English `source` in `code` (i18n/index.ts `t`):
 * the catalog entry, or the English text when the catalog has none.
 * Throws when a non-English catalog lacks the key, so a test never "proves"
 * a translation by comparing English with English.
 */
export function tr(code: LocaleCode, source: string, vars?: Record<string, string | number>): string {
  let text = source
  if (code !== 'en') {
    const hit = catalog(code)[source]
    const value = typeof hit === 'string' ? hit : hit?.other
    if (!value) throw new Error(`the ${code} catalog has no translation for "${source}"`)
    text = value
  }
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text
}

/** Requests the network guard refused ("METHOD url") that went to `host`. */
export function blockedTo(blocked: string[], host: string): string[] {
  return blocked.filter((r) => new URL(r.split(' ')[1]).host === host)
}
