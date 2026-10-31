/**
 * Read a backup the app exported (backupService.ts format):
 *
 *   manifest.json                  {version, appName:'cognitive-canvas', type:'single'|'multi', projectIds}
 *   [projects/<id>/]project.json   one project, at the root for 'single'
 *   [projects/<id>/]data/*.json    workspaceItems, highlights, itemLinks, areaLinks, …
 *   [projects/<id>/]documents/<docId>/{meta.json,file.pdf}
 *   [projects/<id>/]media/<blobId>/{meta.json,file.*}
 *
 * Uses fflate, already an app dependency.
 */
import { readFileSync } from 'node:fs'
import { unzipSync, zipSync, strToU8 } from 'fflate'

export interface BackupManifest { version: number; appName: string; type: 'single' | 'multi'; projectIds: string[]; exportedAt?: number }

export class BackupZip {
  readonly files: Record<string, Uint8Array>
  constructor(bytes: Uint8Array) {
    this.files = unzipSync(bytes)
  }

  static fromFile(path: string) {
    return new BackupZip(new Uint8Array(readFileSync(path)))
  }

  json<T>(name: string): T {
    const f = this.files[name]
    if (!f) throw new Error(`backup has no ${name}; it has: ${Object.keys(this.files).join(', ')}`)
    return JSON.parse(new TextDecoder().decode(f)) as T
  }

  get manifest() { return this.json<BackupManifest>('manifest.json') }

  /** Path prefix holding one project's files. */
  projectRoot(projectId: string) {
    return this.manifest.type === 'single' ? '' : `projects/${projectId}/`
  }

  documentFiles(projectId: string) {
    const root = `${this.projectRoot(projectId)}documents/`
    return Object.keys(this.files).filter((n) => n.startsWith(root) && n.endsWith('/file.pdf'))
  }
}

/** A ZIP that is valid as a ZIP but not a Cognitive Canvas backup. */
export function zipWithout(manifest: boolean): Buffer {
  const entries: Record<string, Uint8Array> = { 'readme.txt': strToU8('not a backup') }
  if (manifest) entries['manifest.json'] = strToU8(JSON.stringify({ version: 1, appName: 'some-other-app', type: 'single', projectIds: [] }))
  return Buffer.from(zipSync(entries))
}
