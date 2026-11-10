/**
 * The Tool Guide's cards as the app defines them, read from its
 * src/components/shared/settings/toolGuideData.ts (in the app copy that
 * `npm run sync-app` makes), so a test can compare every card on screen,
 * sentence by sentence, with what the app means to say.
 *
 * The file is plain data: one object per card with `name`, `desc`, `steps`,
 * an optional `tip` and an optional `desktopOnly: true`, every string a
 * single-quoted t('...'). If its layout changes, guideCards() throws rather
 * than return a partial list.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { APP_DIR } from '../config/env.js'

export interface GuideCard {
  name: string
  desc: string
  steps: string[]
  tip?: string
  /** Marked "Desktop & tablet" on the card. */
  desktopOnly: boolean
}

export type GuideList = 'DOC_TOOLS' | 'WS_TOOLS' | 'LINKING_TOOLS'

const FILE = path.join(APP_DIR, 'src', 'components', 'shared', 'settings', 'toolGuideData.ts')
const STR = String.raw`t\('((?:\\.|[^'\\])*)'\)`
/** A field's string, translated (t('...')) or not ('OCR' is a plain string: the word is not translated). */
const FIELD_STR = String.raw`(?:t\('((?:\\.|[^'\\])*)'\)|'((?:\\.|[^'\\])*)')`
const unquote = (s: string) => s.replace(/\\(.)/g, '$1')

export function guideCards(list: GuideList): GuideCard[] {
  const src = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')
  const start = src.indexOf(`export const ${list}: ToolEntry[] = [`)
  if (start < 0) throw new Error(`${list} not found in ${FILE}`)
  const end = src.indexOf('\n]\n', start)
  if (end < 0) throw new Error(`the end of ${list} not found in ${FILE}`)
  const cards = src.slice(start, end).split('\n  {\n').slice(1).map((entry, i) => {
    const one = (field: string) => {
      const m = entry.match(new RegExp(`\\n?    ${field}: ${FIELD_STR}`))
      return m ? unquote(m[1] ?? m[2]) : undefined
    }
    const steps = entry.match(/ {4}steps: \[\n([\s\S]*?)\n {4}\],/)
    const name = one('name')
    const desc = one('desc')
    if (!name || !desc || !steps) throw new Error(`${list} entry ${i + 1}: name, desc or steps not found`)
    return {
      name,
      desc,
      steps: [...steps[1].matchAll(new RegExp(STR, 'g'))].map((m) => unquote(m[1])),
      tip: one('tip'),
      desktopOnly: /\n {4}desktopOnly: true/.test(entry),
    }
  })
  if (!cards.length) throw new Error(`${list} has no entries in ${FILE}`)
  return cards
}
