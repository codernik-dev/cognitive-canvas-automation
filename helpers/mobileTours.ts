/**
 * The guided-tour steps as the build ships them, read straight from
 * src/components/tours/tourSteps.ts (never copied), so the phone and tablet
 * tour specs compare the card with the real wording: `content`, and the
 * `phoneContent` / `touchContent` / `phoneTarget` / `phoneMode` overrides
 * that resolveStep.ts applies on a phone or a tablet.
 *
 * The file is a list of object literals whose strings are all `t('...')` /
 * `t("...")` calls; this reader understands exactly that shape and throws if a
 * step cannot be read, so a refactor of the file fails loudly here.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

export interface SourceTourStep {
  title: string
  content: string
  target: string | null
  phoneContent?: string
  touchContent?: string
  /** Present only when the step overrides its phone target (null = centred card). */
  phoneTarget?: string | null
  phoneMode?: 'doc' | 'split' | 'canvas'
}

const FILE = path.resolve(import.meta.dirname, '..', '..', 'src', 'components', 'tours', 'tourSteps.ts')

const EXPORTS: Record<string, string> = {
  project: 'projectTourSteps',
  doclist: 'docListTourSteps',
  document: 'documentTourSteps',
  'doc-tools': 'docToolsTourSteps',
  'workspace-tools': 'workspaceToolsTourSteps',
  linking: 'linkingTourSteps',
}

export type SourceTourName = keyof typeof EXPORTS

function unquote(q: string, body: string): string {
  return body.replace(/\\n/g, '\n').replace(new RegExp(`\\\\${q}`, 'g'), q).replace(/\\\\/g, '\\')
}

/** Read `field: t('…')` / `field: '…'` / `field: null` from one step literal. */
function field(src: string, name: string): string | null | undefined {
  const re = new RegExp(`\\b${name}:\\s*(?:t\\()?(?:(null)|(['"])((?:\\\\.|(?!\\2).)*)\\2)`, 's')
  const m = src.match(re)
  if (!m) return undefined
  if (m[1] === 'null') return null
  return unquote(m[2], m[3])
}

let cache: Record<string, SourceTourStep[]> | null = null

export function tourSteps(name: SourceTourName): SourceTourStep[] {
  if (!cache) {
    const src = readFileSync(FILE, 'utf8')
    cache = {}
    for (const [key, ident] of Object.entries(EXPORTS)) {
      const start = src.indexOf(`export const ${ident}`)
      if (start < 0) throw new Error(`${ident} not found in tourSteps.ts`)
      const open = src.indexOf('[', src.indexOf('=', start))
      // Steps are the top-level `{ … }` literals of the array; strings never hold braces here.
      const steps: SourceTourStep[] = []
      let depth = 0
      let from = -1
      for (let i = open + 1; i < src.length; i++) {
        const c = src[i]
        if (c === '{') { if (depth === 0) from = i; depth++ }
        else if (c === '}') { depth--; if (depth === 0) steps.push(parse(src.slice(from, i + 1), ident)) }
        else if (c === ']' && depth === 0) break
      }
      cache[key] = steps
    }
  }
  return cache[name]
}

function parse(literal: string, ident: string): SourceTourStep {
  const title = field(literal, 'title')
  const content = field(literal, 'content')
  const target = field(literal, 'target')
  if (typeof title !== 'string' || typeof content !== 'string' || target === undefined) {
    throw new Error(`a step of ${ident} could not be read:\n${literal}`)
  }
  const step: SourceTourStep = { title, content, target }
  const phoneContent = field(literal, 'phoneContent')
  const touchContent = field(literal, 'touchContent')
  const phoneTarget = field(literal, 'phoneTarget')
  const phoneMode = field(literal, 'phoneMode')
  if (typeof phoneContent === 'string') step.phoneContent = phoneContent
  if (typeof touchContent === 'string') step.touchContent = touchContent
  if (phoneTarget !== undefined) step.phoneTarget = phoneTarget
  if (phoneMode === 'doc' || phoneMode === 'split' || phoneMode === 'canvas') step.phoneMode = phoneMode
  return step
}

/** What the card reads on a phone (resolveStep.ts): phone words, else the desktop ones. */
export function phoneText(step: SourceTourStep): string {
  return step.phoneContent ?? step.content
}

/** What the card reads on a tablet: touch words, else the desktop ones. */
export function tabletText(step: SourceTourStep): string {
  return step.touchContent ?? step.content
}

/** The selector a phone step highlights (null = centred card, no highlight). */
export function phoneTargetOf(step: SourceTourStep): string | null {
  return 'phoneTarget' in step ? (step.phoneTarget ?? null) : step.target
}
