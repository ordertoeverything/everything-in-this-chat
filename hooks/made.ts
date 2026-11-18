import type { Item } from '../types'

// Every file this chat wrote, changed, published as an artifact, or sent to the person,
// plus the look (one color and one icon per section) the pane shares.

export const MADE_SECTIONS: { kind: Item['kind']; title: string }[] = [
  { kind: 'artifact', title: 'Artifacts published' },
  { kind: 'made', title: 'Files made' },
  { kind: 'changed', title: 'Files changed' },
  { kind: 'sent', title: 'Sent to you' },
]
export const MAX_MADE = 400

export type MadeHit = { kind: Item['kind']; target: string; label: string }

const ARTIFACT_RE = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/
const nameOf = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** What one finished tool call adds. `result` is the tool's answer, when there is one. */
export function madeHitsOf(tool: string, input: Record<string, unknown>, result: unknown): MadeHit[] {
  const path = str(input.file_path) || str(input.notebook_path)
  if (tool === 'Write' && path) return [{ kind: 'made', target: path, label: nameOf(path) }]
  if ((tool === 'Edit' || tool === 'NotebookEdit') && path) return [{ kind: 'changed', target: path, label: nameOf(path) }]
  if (tool === 'SendUserFile' && Array.isArray(input.files)) {
    return input.files.filter((f): f is string => typeof f === 'string' && !!f.trim()).map(f => ({ kind: 'sent' as const, target: f, label: nameOf(f) }))
  }
  if (tool === 'Artifact') {
    const action = str(input.action) || 'publish'
    if (action !== 'publish' || input.asset === true) return []
    let text = ''
    try {
      text = typeof result === 'string' ? result : JSON.stringify(result ?? '')
    } catch {
      text = ''
    }
    const url = ARTIFACT_RE.exec(text)?.[0] || str(input.url)
    if (!url) return []
    const label = str(input.title) || (path ? nameOf(path) : '') || url.split('/').pop() || url
    return [{ kind: 'artifact', target: url, label }]
  }
  return []
}

/** Adds hits in place, so each row keeps its index (its press key) for the life of the chat. */
export function applyMade(items: Item[], hits: { hit: MadeHit; at: number; time: number }[]): Item[] {
  const out = [...items]
  for (const { hit, at: seq, time } of hits) {
    // A file made in this chat and then edited stays under "Files made".
    const kind = hit.kind === 'changed' && out.some(i => i.kind === 'made' && i.target === hit.target) ? 'made' : hit.kind
    const at = out.findIndex(i => i.kind === kind && i.target === hit.target)
    if (at >= 0) {
      const old = out[at]!
      out[at] = { ...old, label: kind === 'artifact' ? hit.label : old.label, count: old.count + 1, seq, at: time || old.at }
    } else if (out.length < MAX_MADE) {
      out.push({ kind, target: hit.target, label: hit.label, count: 1, seq, at: time })
    }
  }
  return out
}

/** "MD", "HTML", "PNG"; "PAGE" for an artifact. */
export function tagOf(it: Item): string {
  if (it.kind === 'artifact') return 'PAGE'
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(it.label)?.[1]
  return ext ? ext.toUpperCase() : 'FILE'
}

// ---- The look: one color and one icon per section, the icon matching the section's words ----
// `glyph` is the terminal's stand-in; the desktop draws `icon`, a line drawing in the section's color.
const FILE = 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5'
const ICONS: Record<string, string> = {
  // a checked box
  todo: 'M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z M8 12.5l3 3 5.5-6',
  // a globe: a page on the web
  artifact: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 3c-2.5 2.5-3.8 5.5-3.8 9s1.3 6.5 3.8 9 M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9 M3.5 9h17 M3.5 15h17',
  // a page with a plus
  made: `${FILE} M12 11v6 M9 14h6`,
  // a pencil
  changed: 'M16.5 3.5l4 4L8 20H4v-4z M14 6l4 4',
  // a paper plane
  sent: 'M21.5 2.5L10.5 13.5 M21.5 2.5l-7 19-4-8-8-4z',
  // two chain links
  connectors: 'M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5 M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5',
  // a page with lines of text
  files: `${FILE} M9 13h6 M9 17h6`,
  // a folder
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  // a lightning bolt
  skills: 'M13 2L4 14h7l-1 8 9-12h-7z',
  // a little robot head: antenna, face, eyes, ears
  // a speedometer gauge: the arc, the needle, the hub
  usage: 'M4 17a8 8 0 1 1 16 0 M12 17l4-5 M12 17h0.01',
  helpers: 'M6 8h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M12 8V4 M12 4h0.01 M9 13h0.01 M15 13h0.01 M2 12v3 M22 12v3',
}
export const LOOK: Record<string, { color: string; glyph: string }> = {
  todo: { color: '#E5484D', glyph: '☑' },
  artifact: { color: '#D4A000', glyph: '⊕' },
  made: { color: '#7CB518', glyph: '✚' },
  changed: { color: '#2E9E5B', glyph: '✎' },
  sent: { color: '#12A594', glyph: '➤' },
  connectors: { color: '#1C9AD6', glyph: '⇄' },
  files: { color: '#5B5FD6', glyph: '▤' },
  skills: { color: '#8E5BD9', glyph: '⚡' },
  helpers: { color: '#F0643C', glyph: '⚙' },
  folder: { color: '#3A6FF0', glyph: '▣' },
  usage: { color: '#E39B5B', glyph: '◔' },
}

/** The section's icon as a small line drawing in its color, or '' when it has none. */
export function iconSvg(key: string): string {
  const d = ICONS[key]
  if (!d) return ''
  const c = LOOK[key]?.color ?? '#6B7280'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    d.split(' M').map((p, i) => `<path d="${i ? 'M' : ''}${p}"/>`).join('') +
    `</svg>`
  )
}

const CHIP: Record<string, string> = {
  PAGE: '#C2417A', MD: '#5B5FD6', HTML: '#E07A5F', HTM: '#E07A5F', CSS: '#E07A5F',
  PNG: '#2E9E5B', JPG: '#2E9E5B', JPEG: '#2E9E5B', GIF: '#2E9E5B', SVG: '#2E9E5B', WEBP: '#2E9E5B',
  PDF: '#D64545', DOCX: '#2B579A', DOC: '#2B579A', CSV: '#1F8A4C', XLSX: '#1F8A4C',
  MP4: '#8E5BD9', MOV: '#8E5BD9', MP3: '#8E5BD9', ZIP: '#7A6A58',
}
export const chipColor = (tag: string) => CHIP[tag] ?? '#6B7280'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const FONT = '-apple-system, Helvetica, Arial, sans-serif'

/** A rounded type chip: "MD" in white on its color. */
export function chipSvg(tag: string): string {
  const t = esc(tag.slice(0, 5))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 13" width="32" height="13">` +
    `<rect x="0.5" y="0.5" width="31" height="12" rx="6" fill="${chipColor(tag)}"/>` +
    `<text x="16" y="9.2" text-anchor="middle" font-family="${FONT}" font-size="7.2" font-weight="700" letter-spacing="0.3" fill="#ffffff">${t}</text>` +
    `</svg>`
  )
}

// ---- Helpers: the model chip ----
const MODEL_COLOR: Record<string, string> = {
  SONNET: '#3A86FF', HAIKU: '#2A9D8F', OPUS: '#C2417A', FABLE: '#D99A1E', SAME: '#6B7280',
}
/** SONNET, HAIKU, OPUS, FABLE; SAME when the call named no model (the chat's own). */
export function modelLabel(model: unknown): string {
  const m = typeof model === 'string' ? model.trim().toLowerCase() : ''
  if (!m) return 'SAME'
  for (const k of ['sonnet', 'haiku', 'opus', 'fable']) if (m.includes(k)) return k.toUpperCase()
  return m.replace(/[^a-z0-9]/g, '').slice(0, 6).toUpperCase() || 'SAME'
}
export const modelColor = (label: string) => MODEL_COLOR[label] ?? '#6B7280'

/** A rounded model chip, a little wider than the type chip. */
export function modelChipSvg(label: string): string {
  const t = esc(label.slice(0, 6))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 18" width="56" height="18">` +
    `<rect x="0.5" y="0.5" width="55" height="17" rx="8.5" fill="${modelColor(label)}"/>` +
    `<text x="28" y="12.6" text-anchor="middle" font-family="${FONT}" font-size="9.5" font-weight="700" letter-spacing="0.6" fill="#ffffff">${t}</text>` +
    `</svg>`
  )
}
