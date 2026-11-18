import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, SessionMessage } from 'claude-code'

import type { AppUse, Board, Helper, Helpers, Item, Step, Work } from '../types'
import { LOOK, MADE_SECTIONS, applyMade, chipColor, chipSvg, iconSvg, madeHitsOf, modelChipSvg, modelColor, modelLabel, tagOf } from './made'

const NAME = 'everything-in-this-chat'
const PANE = NAME
const TITLE = 'Everything in this chat'

// Change a tag when the shape of what it stores changes: an older value is declined.
const emptyBoard: Board = {
  todo: [],
  items: [],
  apps: [],
  reads: [],
  skills: [],
  memory: [],
  skillNames: [],
  seen: [],
  seq: 0,
  seeded: false,
  opened: false,
}
const board = atom({ plugin: 'everything-in-this-chat', key: 'board' } as const, emptyBoard, { shape: 'board-1' })
const helpersAtom = atom({ plugin: 'everything-in-this-chat', key: 'helpers' } as const, { list: [], seeded: false } as Helpers, { shape: 'helpers-1' })
const emptyWork: Work = { listStart: 0, doneAt: [], helperStart: 0 }
const workAtom = atom({ plugin: 'everything-in-this-chat', key: 'work' } as const, emptyWork, { shape: 'work-1' })
const foldedSet = atom({ plugin: 'everything-in-this-chat', key: 'folded' } as const, [] as string[])
const openDirsSet = atom({ plugin: 'everything-in-this-chat', key: 'openDirs' } as const, [] as string[])
const openAppsSet = atom({ plugin: 'everything-in-this-chat', key: 'openApps' } as const, [] as string[])

const SEEN_MAX = 4000
const READS_MAX = 200
const CALLS_MAX = 40
const FILES_SHOWN = 40
const MADE_SHOWN = 30
const DIR_ROWS_MAX = 60
const HELPERS_MAX = 100
const HELPERS_SHOWN = 30

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const nameOf = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p
const parentOf = (p: string) => {
  const parts = p.replace(/\/+$/, '').split('/').filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2]! : ''
}
const pad = (n: number) => (n < 10 ? '0' + n : String(n))
const hhmm = (ms: number) => {
  if (!ms) return ''
  const d = new Date(ms)
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}
const titleCase = (s: string) =>
  s
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(w => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ')
const toggleIn = (list: string[] | undefined, v: string) => {
  const l = list ?? []
  return l.includes(v) ? l.filter(x => x !== v) : [...l, v]
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

// ---------------------------------------------------------------------------------------------
// The to-do list
// ---------------------------------------------------------------------------------------------

const statusOf = (s: unknown): Step['status'] => {
  const v = str(s)
  if (v === 'completed' || v === 'done') return 'completed'
  if (v === 'in_progress') return 'in_progress'
  return 'pending'
}

function advanceSteps(steps: Step[]): Step[] {
  const out = steps.map(s => ({ ...s }))
  const cur = out.findIndex(s => s.status === 'in_progress')
  let from = 0
  if (cur >= 0) {
    out[cur]!.status = 'completed'
    from = cur + 1
  }
  const nx = out.findIndex((s, i) => i >= from && s.status === 'pending')
  if (nx >= 0) out[nx]!.status = 'in_progress'
  return out
}

/** The to-do list after one task-list tool call, or null when the call did not touch it. */
function todoAfter(todo: Step[], tool: string, input: Record<string, unknown>, text: string): Step[] | null {
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    const out: Step[] = []
    for (const t of input.todos as Record<string, unknown>[]) {
      const content = str(t?.content) || str(t?.subject) || str(t?.activeForm)
      if (content) out.push({ content, status: statusOf(t?.status) })
    }
    return out
  }
  if (tool === 'TaskCreate') {
    const content = str(input.subject) || str(input.description)
    if (!content) return null
    const found = /#(\d+)/.exec(text) ?? /"id"\s*:\s*"?(\d+)/.exec(text)
    const id = found?.[1] ?? String(todo.filter(s => s.id).length + 1)
    return [...todo, { content, status: 'pending', id }]
  }
  if (tool === 'TaskUpdate') {
    const id = str(input.taskId)
    if (!id) return null
    const status = str(input.status)
    if (status === 'deleted') return todo.filter(s => s.id !== id)
    return todo.map(s =>
      s.id === id ? { ...s, content: str(input.subject) || s.content, status: status ? statusOf(status) : s.status } : s,
    )
  }
  if (tool === 'mcp__ccd_turn__update_plan') {
    if (Array.isArray(input.items)) {
      const out: Step[] = []
      for (const t of input.items as Record<string, unknown>[]) {
        const content = str(t?.content)
        if (content) out.push({ content, status: statusOf(t?.status) })
      }
      return out
    }
    let out = todo
    let touched = false
    if (input.advance === true) {
      out = advanceSteps(out)
      touched = true
    }
    if (Array.isArray(input.done)) {
      const idx = (input.done as unknown[]).filter((n): n is number => typeof n === 'number')
      out = out.map((s, i) => (idx.includes(i + 1) ? { ...s, status: 'completed' as const } : s))
      touched = true
    }
    if (typeof input.start === 'number') {
      const at = input.start
      out = out.map((s, i) => (i + 1 === at ? { ...s, status: 'in_progress' as const } : s))
      touched = true
    }
    return touched ? out : null
  }
  if (tool === 'mcp__ccd_turn__wrap_up') {
    return todo.map(s => ({ ...s, status: 'completed' as const }))
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------------------------

const KNOWN_APPS: Record<string, string> = {
  gohighlevel: 'GoHighLevel',
  'claude-in-chrome': 'Chrome',
  claude_browser: 'Built-in browser',
  apify: 'Apify',
  easel: 'Charts',
}
const FIRST_WORDS: Record<string, string> = {
  notion: 'Notion',
  gmail: 'Gmail',
  calendar: 'Calendar',
  slack: 'Slack',
  canva: 'Canva',
  drive: 'Google Drive',
  shopify: 'Shopify',
}
const GENERIC_VERBS = new Set([
  'get', 'list', 'create', 'update', 'delete', 'search', 'read', 'send', 'add', 'set', 'find', 'fetch',
  'query', 'open', 'run', 'ask', 'batch', 'guide', 'upload', 'download', 'copy', 'move', 'remove',
])
const COMPOSIO_APPS: Record<string, string> = {
  googlecalendar: 'Google Calendar',
  googledrive: 'Google Drive',
  googlesheets: 'Google Sheets',
  googledocs: 'Google Docs',
  github: 'GitHub',
}
// Words inside a verb-first tool name that point at its app: "search_threads" is Gmail.
const HINT_WORDS: Record<string, string> = {
  thread: 'Gmail', threads: 'Gmail', draft: 'Gmail', drafts: 'Gmail', label: 'Gmail', labels: 'Gmail', spam: 'Gmail',
  event: 'Google Calendar', events: 'Google Calendar', calendars: 'Google Calendar',
  granola: 'Granola',
  recording: 'Zoom', recordings: 'Zoom', meeting: 'Zoom', meetings: 'Zoom',
  design: 'Canva', designs: 'Canva',
  file: 'Google Drive', files: 'Google Drive', drives: 'Google Drive',
  page: 'Notion', pages: 'Notion',
  clips: 'Descript',
}
const SERVER_NAMES = new Map<string, string>()
const UUID_RE =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SKIPPED_SERVERS = (s: string) => s.startsWith('ccd_') || s === 'plugin-authoring' || s === 'visualize'

function appName(server: string, tool: string): string {
  const key = server.toLowerCase()
  const known = KNOWN_APPS[key]
  if (known) return known
  if (key.startsWith('leadconnector')) return 'LeadConnector'
  if (key.startsWith('gohighlevel')) return 'GoHighLevel'
  if (UUID_RE.test(server)) {
    // A server with only an ID for a name: once any of its tools gives the app away, keep that name.
    const remembered = SERVER_NAMES.get(server)
    if (remembered) return remembered
    const words = tool.toLowerCase().split(/[-_]/).filter(Boolean)
    const first = words[0] ?? ''
    let name = ''
    if (first && !GENERIC_VERBS.has(first)) name = FIRST_WORDS[first] ?? titleCase(first)
    else name = words.map(w => HINT_WORDS[w]).find(Boolean) ?? ''
    if (!name) return 'App ' + server.slice(0, 4)
    SERVER_NAMES.set(server, name)
    return name
  }
  if (key.startsWith('plugin')) {
    const last = server.split(/[:_]/).pop() ?? server
    return titleCase(last)
  }
  return titleCase(server.replace(/^claude[_ .-]?ai[_ .-]*/i, ''))
}

const MAIN_ARG_FIELDS = [
  'query', 'q', 'url', 'title', 'name', 'subject', 'file_path', 'path', 'command', 'page_id', 'id',
  'text', 'message', 'prompt', 'search', 'operation', 'slug',
]
function mainArg(input: Record<string, unknown>): string {
  for (const k of MAIN_ARG_FIELDS) {
    const v = input[k]
    if (typeof v === 'string' && v.trim()) return v.trim().replace(/\s+/g, ' ').slice(0, 60)
    if (typeof v === 'number') return String(v)
  }
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.trim()) return v.trim().replace(/\s+/g, ' ').slice(0, 60)
  }
  return ''
}

/** Which app one tool call belongs to, and how to word it. Null for a call that is not a connector. */
function appOf(tool: string, input: Record<string, unknown>): { app: string; words: string; arg: string } | null {
  if (tool.startsWith('mcp__')) {
    const rest = tool.slice(5)
    const at = rest.indexOf('__')
    if (at <= 0) return null
    const server = rest.slice(0, at)
    const name = rest.slice(at + 2)
    if (!name || SKIPPED_SERVERS(server)) return null
    return { app: appName(server, name), words: name.replace(/[-_]+/g, ' '), arg: mainArg(input) }
  }
  if (tool === 'Bash') {
    const m = /composio\s+execute\s+([A-Za-z0-9_]+)/i.exec(str(input.command))
    if (!m) return null
    const parts = m[1]!.toLowerCase().split('_')
    const first = parts[0]!
    const rest = parts.slice(1).join(' ')
    return { app: COMPOSIO_APPS[first] ?? titleCase(first), words: rest || parts.join(' '), arg: '' }
  }
  return null
}

function addApp(apps: AppUse[], hit: { app: string; words: string; arg: string }, time: number): AppUse[] {
  const call = { words: hit.words, arg: hit.arg, at: time }
  const i = apps.findIndex(a => a.name === hit.app)
  if (i < 0) return [...apps, { name: hit.app, count: 1, calls: [call] }]
  return apps.map((a, j) => (j === i ? { ...a, count: a.count + 1, calls: [...a.calls, call].slice(-CALLS_MAX) } : a))
}

// ---------------------------------------------------------------------------------------------
// Recording one finished tool call
// ---------------------------------------------------------------------------------------------

type Call = {
  id: string
  tool: string
  input: Record<string, unknown>
  result?: unknown
  text?: string
  isError?: boolean
  isHelper: boolean
  time: number
}

const SCRATCH = [
  /\/tool-results\//,
  /^\/private\/tmp\//,
  /^\/tmp\//,
  /^\/var\/folders\//,
  /\/\.claude\/projects\/[^/]+\/[0-9a-fA-F-]{36}\//,
]

function addSkillUse(b: Board, raw: string): Board {
  const name = raw.replace(/^\//, '').trim()
  if (!name) return b
  const has = b.skills.some(s => s.name === name)
  return {
    ...b,
    skills: has ? b.skills.map(s => (s.name === name ? { ...s, uses: s.uses + 1 } : s)) : [...b.skills, { name, uses: 1 }],
  }
}

function recordCall(b: Board, c: Call): Board {
  if (c.isError) return b
  if (c.id && b.seen.includes(c.id)) return b
  let out: Board = c.id ? { ...b, seen: [...b.seen, c.id].slice(-SEEN_MAX) } : b
  const text = c.text ?? ''

  if (!c.isHelper) {
    const todo = todoAfter(out.todo, c.tool, c.input, text)
    if (todo) out = { ...out, todo }
    const hits = madeHitsOf(c.tool, c.input, c.result ?? c.text)
    if (hits.length) {
      let seq = out.seq
      const mapped = hits.map(hit => ({ hit, at: ++seq, time: c.time }))
      out = { ...out, items: applyMade(out.items, mapped), seq }
    }
  }

  const app = appOf(c.tool, c.input)
  if (app) out = { ...out, apps: addApp(out.apps, app, c.time) }

  if (c.tool === 'Read') {
    const path = str(c.input.file_path)
    const skill = /\/([^/]+)\/SKILL\.md$/.exec(path)
    if (skill) {
      out = addSkillUse(out, skill[1]!)
    } else if (path && !SCRATCH.some(re => re.test(path))) {
      const seq = out.seq + 1
      const reads = [...out.reads.filter(r => r.path !== path), { path, seq }].slice(-READS_MAX)
      out = { ...out, reads, seq }
    }
  }
  if (c.tool === 'Skill') out = addSkillUse(out, str(c.input.skill))
  return out
}

const hasThings = (b: Board) =>
  b.todo.length > 0 || b.items.length > 0 || b.apps.length > 0 || b.reads.length > 0 || b.skills.length > 0

/** Fills a fresh board from the rows the chat already holds. Does nothing twice. */
function seedBoard(b: Board, msgs: SessionMessage[], memory: string[], skillNames: string[]): Board {
  if (b.seeded) return b
  let out: Board = { ...b, memory, skillNames }
  for (const m of msgs) {
    if (m.role === 'user') {
      const tag = /^\s*<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/.exec(m.text)
      const slash = /^\s*\/([A-Za-z0-9:._-]+)/.exec(m.text)
      const name = tag?.[1] ?? slash?.[1]
      if (name && skillNames.includes(name)) out = addSkillUse(out, name)
      continue
    }
    for (const tu of m.toolUses) {
      out = recordCall(out, {
        id: tu.tool_use_id,
        tool: tu.tool,
        input: tu.input,
        result: tu.result,
        text: tu.text,
        isError: tu.isError === true,
        isHelper: false,
        time: 0,
      })
    }
  }
  // A chat that already had things when the pane first met it counts as already shown.
  return { ...out, seeded: true, opened: out.opened || hasThings(out) }
}

// ---------------------------------------------------------------------------------------------
// Helpers: the Agent calls the main chat made
// ---------------------------------------------------------------------------------------------

/** One row for an Agent call made by the main chat, or null for any other call. */
function helperOf(c: Call & { agentId?: string; pending?: boolean }, seq: number): Helper | null {
  if (c.isHelper || (c.tool !== 'Agent' && c.tool !== 'Task')) return null
  const r = c.result && typeof c.result === 'object' ? (c.result as Record<string, unknown>) : {}
  const launched = r.status === 'async_launched' || r.status === 'remote_launched'
  const bg = launched || c.input.run_in_background === true
  let status: Helper['status'] = 'done'
  if (c.isError) status = 'failed'
  else if (c.pending || launched) status = 'working'
  else if (bg && r.status !== 'completed' && c.result === undefined) status = 'working'
  const desc = str(c.input.description) || str(c.input.prompt).replace(/\s+/g, ' ').slice(0, 40) || 'Helper'
  return {
    id: c.id,
    agentId: str(r.agentId) || str(r.taskId) || str(c.agentId),
    desc,
    model: modelLabel(c.input.model),
    bg,
    status,
    at: c.time,
    seq,
  }
}

function addHelper(h: Helpers, c: Call & { agentId?: string; pending?: boolean }): Helpers {
  const row = helperOf(c, h.list.reduce((m, x) => Math.max(m, x.seq), 0) + 1)
  if (!row) return h
  if (row.id && h.list.some(x => x.id === row.id)) return h
  return { ...h, list: [...h.list, row].slice(-HELPERS_MAX) }
}

/** Finished background tasks, read from the notification messages Claude Code adds to the chat. */
function noticesIn(msgs: SessionMessage[]): Map<string, Helper['status']> {
  const out = new Map<string, Helper['status']>()
  for (const m of msgs) {
    if (m.role !== 'user' || !m.text || !m.text.includes('<task-notification')) continue
    for (const block of m.text.match(/<task-notification>[\s\S]*?<\/task-notification>/g) ?? []) {
      const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(block)?.[1]
      const st = /<status>\s*([^<\s]+)\s*<\/status>/.exec(block)?.[1]?.toLowerCase()
      if (!id || !st) continue
      if (st === 'completed') out.set(id, 'done')
      else if (st === 'failed' || st === 'killed' || st === 'error' || st === 'stopped') out.set(id, 'failed')
    }
  }
  return out
}

/** The same list with finished tasks marked; the very same list when nothing changed. */
function applyNotices(list: Helper[], found: Map<string, Helper['status']>): Helper[] {
  if (found.size === 0) return list
  let changed = false
  const out = list.map(x => {
    if (x.status !== 'working') return x
    const st = (x.agentId && found.get(x.agentId)) || found.get(x.id)
    if (!st) return x
    changed = true
    return { ...x, status: st }
  })
  return changed ? out : list
}

const anyWorking = (h: Helpers) => h.list.some(x => x.status === 'working')

const AGENT_CACHE_MS = 5000
let agentCache: { at: number; list: AgentInfo[] } | null = null

/** The engine's own list of agents, cached for a few seconds. Throws when the engine cannot answer. */
async function agentList($: EngineInterface, force = false): Promise<AgentInfo[]> {
  const now = Number(await $.clock.now())
  if (!force && agentCache && now - agentCache.at < AGENT_CACHE_MS && now >= agentCache.at) return agentCache.list
  const list = await $.agent.list()
  agentCache = { at: now, list }
  return list
}

const mapAgent = (st: AgentInfo['status']): Helper['status'] =>
  st === 'pending' || st === 'running' || st === 'waiting' ? 'working' : st === 'failed' || st === 'killed' ? 'failed' : 'done'

/** Working rows settled by the engine's list: a helper it no longer lists is done; one with no id yet is left alone. */
function applyAgents(list: Helper[], agents: AgentInfo[]): Helper[] {
  const byId = new Map(agents.map(a => [a.id, a]))
  let changed = false
  const out = list.map(x => {
    if (x.status !== 'working' || !x.agentId) return x
    const found = byId.get(x.agentId)
    const st: Helper['status'] = found ? mapAgent(found.status) : 'done'
    if (st === x.status) return x
    changed = true
    return { ...x, status: st }
  })
  return changed ? out : list
}

/** The rows settled by the engine's list, or by the chat's notices when the list cannot be read. */
async function settled($: EngineInterface, list: Helper[], force = false): Promise<Helper[]> {
  let out = list
  try {
    out = applyAgents(out, await agentList($, force))
  } catch {
    try {
      out = applyNotices(out, noticesIn(await $.session.messages()))
    } catch {
      // show what is stored
    }
    return out
  }
  // a row with no id yet can only be settled by its notice
  if (out.some(x => x.status === 'working' && !x.agentId)) {
    try {
      out = applyNotices(out, noticesIn(await $.session.messages()))
    } catch {
      // show what is stored
    }
  }
  return out
}

/** Writes the settled statuses to state, only while some helper is still working. */
async function syncHelpers($: EngineInterface, force = false): Promise<void> {
  try {
    const h = await read($, helpersAtom)
    if (!anyWorking(h)) return
    const list = await settled($, h.list, force)
    if (list === h.list) return
    const byId = new Map(list.map(x => [x.id, x.status]))
    await update($, helpersAtom, cur => {
      let changed = false
      const next = cur.list.map(x => {
        const st = byId.get(x.id)
        if (x.status === 'working' && st && st !== 'working') {
          changed = true
          return { ...x, status: st }
        }
        return x
      })
      return changed ? { ...cur, list: next } : cur
    })
  } catch {
    // a missed check is caught on the next one
  }
}

async function seedHelpers($: EngineInterface): Promise<void> {
  try {
    const cur = await read($, helpersAtom)
    if (cur.seeded) return
    const msgs = await $.session.messages()
    await update($, helpersAtom, h => {
      if (h.seeded) return h
      let out: Helpers = h
      for (const m of msgs) {
        if (m.role !== 'assistant') continue
        for (const tu of m.toolUses) {
          out = addHelper(out, {
            id: tu.tool_use_id,
            tool: tu.tool,
            input: tu.input,
            result: tu.result,
            text: tu.text,
            isError: tu.isError === true,
            isHelper: false,
            time: 0,
            agentId: tu.agentId,
            pending: tu.result === undefined && tu.text === undefined && tu.isError !== true,
          })
        }
      }
      return { list: applyNotices(out.list, noticesIn(msgs)), seeded: true }
    })
  } catch {
    // history is a nice extra
  }
}

// ---------------------------------------------------------------------------------------------
// The work status bar: where Claude is, and a rough time left
// ---------------------------------------------------------------------------------------------

const TICK_MS = 15000
const todoLive = (todo: Step[]) => todo.length > 0 && todo.some(s => s.status !== 'completed')
const doneOf = (todo: Step[]) => todo.filter(s => s.status === 'completed').length

/** True when a new to-do list has replaced the old one, not just updated it. */
function isNewList(prev: Step[], next: Step[]): boolean {
  if (next.length === 0) return false
  if (prev.length === 0) return true
  if (!todoLive(prev)) return true
  return !next.some(s => prev.some(p => p.content === s.content))
}

/** Records when a list started and when each step finished, after one to-do change. */
async function trackWork($: EngineInterface, prev: Step[], next: Step[]): Promise<void> {
  try {
    if (prev === next) return
    const now = Number(await $.clock.now())
    await update($, workAtom, w => {
      if (isNewList(prev, next)) return { ...w, listStart: now, doneAt: [] }
      const gained = doneOf(next) - doneOf(prev)
      if (gained <= 0) return w
      const times = [...w.doneAt]
      for (let i = 0; i < gained; i++) times.push(now)
      return { ...w, doneAt: times.slice(-200) }
    })
  } catch {
    // the status bar is an extra
  }
}

/** Starts the clocks the first time live work is seen (history has no live times). */
async function ensureClock($: EngineInterface): Promise<void> {
  try {
    const b = await read($, board)
    const hs = await read($, helpersAtom)
    const w = await read($, workAtom)
    const live = todoLive(b.todo)
    const working = anyWorking(hs)
    const wantList = live && w.listStart === 0
    const wantHelper = working && w.helperStart === 0
    const dropHelper = !working && w.helperStart !== 0
    if (!wantList && !wantHelper && !dropHelper) return
    const now = Number(await $.clock.now())
    await update($, workAtom, cur => ({
      ...cur,
      listStart: live && cur.listStart === 0 ? now : cur.listStart,
      helperStart: working ? (cur.helperStart === 0 ? now : cur.helperStart) : 0,
    }))
  } catch {
    // a missed start is caught on the next tick
  }
}

type WorkInfo = {
  done: number
  total: number
  current: string
  helpers: number
  elapsedMs: number
  /** Null until a step has finished live: no number is shown then. */
  leftMs: number | null
}

/** What the bar says, or null when no work is live. */
function workInfo(todo: Step[], hs: Helpers, w: Work, now: number): WorkInfo | null {
  const hasTodo = todoLive(todo)
  const helpers = hs.list.filter(x => x.status === 'working')
  if (!hasTodo && helpers.length === 0) return null
  const done = hasTodo ? doneOf(todo) : 0
  const total = hasTodo ? todo.length : 0
  const step = hasTodo ? (todo.find(s => s.status === 'in_progress') ?? todo.find(s => s.status !== 'completed')) : undefined
  let startedAt = 0
  if (hasTodo) startedAt = w.listStart
  else {
    const times = helpers.map(x => x.at).filter(t => t > 0)
    startedAt = times.length ? Math.min(...times) : w.helperStart
  }
  const elapsedMs = startedAt > 0 ? Math.max(0, now - startedAt) : 0
  let leftMs: number | null = null
  if (hasTodo && w.listStart > 0 && w.doneAt.length > 0) {
    const last = Math.max(...w.doneAt)
    const each = (last - w.listStart) / w.doneAt.length
    if (each >= 0) leftMs = each * (total - done)
  }
  return { done, total, current: step?.content ?? '', helpers: helpers.length, elapsedMs, leftMs }
}

const elapsedWords = (ms: number) => {
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just started'
  if (m < 60) return m + ' min in'
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min in'
}
const leftWords = (ms: number) => {
  const m = Math.round(ms / 60000)
  return m < 1 ? 'under a minute left' : 'about ' + m + ' min left'
}
const helperWords = (n: number) => n + (n === 1 ? ' helper working' : ' helpers working')
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

/** Plain words for a rate-limit window's kind. */
const limitName = (kind: string) =>
  kind === 'five_hour' ? '5-hour limit' : kind === 'seven_day' ? 'Weekly limit' : kind === 'spend_limit' ? 'Spend limit' : titleCase(kind.replace(/_/g, ' ')) + ' limit'

/** When a limit resets: a clock time today, or a weekday and time further out. */
function resetWords(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  let hr = d.getHours()
  const ap = hr < 12 ? 'am' : 'pm'
  hr = hr % 12 || 12
  const time = hr + ':' + pad(d.getMinutes()) + ' ' + ap
  if (t - now < 20 * 3600000) return 'resets ' + time
  return 'resets ' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + time
}

function barSvg(done: number, total: number, color: string, width: number): string {
  const w = done <= 0 ? 0 : Math.min(width, Math.max(10, Math.round((done / total) * width)))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 10" width="${width}" height="10">` +
    `<rect width="${width}" height="10" rx="5" fill="#E5E7EB"/>` +
    (w > 0 ? `<rect width="${w}" height="10" rx="5" fill="${color}"/>` : '') +
    `</svg>`
  )
}
const textBar = (done: number, total: number, len: number) => {
  const on = Math.min(len, Math.round((done / total) * len))
  return '▰'.repeat(on) + '▱'.repeat(len - on)
}

/** The status bar: a wide progress bar with one small dim line under it. Pane only. */
function workRow(info: WorkInfo | null, ui: { Box: any; Text: any; Svg?: any }, isDesk: boolean, columns: number) {
  const { Box, Text, Svg } = ui
  const color = '#2A9D8F'
  if (!info) {
    const cols0 = Math.max(20, columns || 60)
    const w0 = Math.max(200, cols0 * 10)
    return (
      <Box key="work-row" flexDirection="column">
        {isDesk && Svg ? (
          <Svg source={barSvg(0, 1, color, w0)} alt="Nothing running right now" />
        ) : (
          <Text dimColor>{textBar(0, 1, Math.min(40, cols0 - 4))}</Text>
        )}
        <Text dimColor wrap="truncate-end">Nothing running right now</Text>
      </Box>
    )
  }
  const hasTodo = info.total > 0
  const parts: string[] = []
  if (hasTodo) parts.push('Step ' + Math.min(info.total, info.done + 1) + ' of ' + info.total)
  else parts.push(helperWords(info.helpers))
  if (hasTodo) parts.push(info.leftMs === null ? 'estimate after step 1' : leftWords(info.leftMs))
  parts.push(elapsedWords(info.elapsedMs))
  if (hasTodo && info.helpers > 0) parts.push(helperWords(info.helpers))
  const cols = Math.max(20, columns || 60)
  const bar = !hasTodo ? null : isDesk && Svg ? (
    <Svg
      source={barSvg(info.done, info.total, color, Math.max(200, cols * 10))}
      alt={info.done + ' of ' + info.total + ' steps done'}
    />
  ) : (
    <Text color={color}>{textBar(info.done, info.total, Math.min(40, cols - 4))}</Text>
  )
  return (
    <Box key="work-row" flexDirection="column">
      {bar}
      <Text dimColor wrap="wrap">
        {parts.join(' · ')}
      </Text>
    </Box>
  )
}

/** The helpers with finished ones marked, for drawing (never writes). */
async function liveHelpers($: EngineInterface): Promise<Helpers> {
  const hs = await read($, helpersAtom)
  if (!anyWorking(hs)) return hs
  const list = await settled($, hs.list)
  return list === hs.list ? hs : { ...hs, list }
}

let ticker: { cancel: () => void } | null = null

/** Starts the 15 second tick once; a reload drops the timer and the module variable together. */
function startTicker($: EngineInterface): void {
  if (ticker) return
  ticker = $.clock.every(TICK_MS, () => {
    void (async () => {
      try {
        await syncHelpers($)
        const b = await read($, board)
        const hs = await read($, helpersAtom)
        if (!todoLive(b.todo) && !anyWorking(hs)) return
        await ensureClock($)
        $.ui.invalidate('ui.render')
      } catch {
        // the next tick tries again
      }
    })()
  })
}

// ---------------------------------------------------------------------------------------------
// Opening files and links
// ---------------------------------------------------------------------------------------------

let os: 'mac' | 'linux' | 'windows' | null = null
async function platform($: EngineInterface): Promise<'mac' | 'linux' | 'windows'> {
  if (os) return os
  try {
    if ((await $.env.get('OS')) === 'Windows_NT') return (os = 'windows')
  } catch {
    // fall through to the next check
  }
  try {
    const r = await $.process.run(['uname', '-s'])
    if (r.exitCode === 0) return (os = r.stdout.trim() === 'Darwin' ? 'mac' : 'linux')
  } catch {
    // no uname: this is Windows
  }
  return (os = 'windows')
}

async function openTarget($: EngineInterface, target: string, name: string): Promise<void> {
  try {
    const kind = await platform($)
    const argv =
      kind === 'mac' ? ['open', target] : kind === 'linux' ? ['xdg-open', target] : ['cmd', '/c', 'start', '', target]
    const r = await $.process.run(argv)
    if (r.exitCode !== 0) await $.ui.toast('Could not open ' + name)
  } catch {
    try {
      await $.ui.toast('Could not open ' + name)
    } catch {
      // nothing more to do
    }
  }
}

/** Shows a file selected in its folder: Finder, File Explorer, or the parent folder elsewhere. */
async function showInFinder($: EngineInterface, target: string, name: string): Promise<void> {
  try {
    const kind = await platform($)
    const parent = target.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '') || '/'
    const argv = kind === 'mac' ? ['open', '-R', target] : kind === 'windows' ? ['explorer', '/select,' + target] : ['xdg-open', parent]
    const r = await $.process.run(argv)
    // Explorer answers 1 even when it worked, so only the other two judge by the exit code.
    if (kind !== 'windows' && r.exitCode !== 0) await $.ui.toast('Could not show ' + name)
  } catch {
    try {
      await $.ui.toast('Could not show ' + name)
    } catch {
      // nothing more to do
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Folder listings, cached for a few seconds
// ---------------------------------------------------------------------------------------------

type Listing = { dirs: string[]; files: number; fileNames: string[] }
const listCache = new Map<string, { at: number; value: Listing }>()

async function listDir($: EngineInterface, path: string): Promise<Listing> {
  const now = Number(await $.clock.now())
  const hit = listCache.get(path)
  if (hit && now - hit.at < 5000) return hit.value
  const value: Listing = { dirs: [], files: 0, fileNames: [] }
  try {
    for (const entry of await $.fs.list(path)) {
      if (entry.name.startsWith('.')) continue
      if (entry.kind === 'dir') value.dirs.push(entry.name)
      else if (entry.kind === 'file') {
        value.files += 1
        value.fileNames.push(entry.name)
      }
    }
    value.dirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    value.fileNames.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  } catch {
    // an unreadable folder shows as empty
  }
  listCache.set(path, { at: now, value })
  return value
}

type DirRow =
  | { kind: 'dir'; path: string; name: string; depth: number; isOpen: boolean; files: number }
  | { kind: 'file'; path: string; name: string; depth: number }
  | { kind: 'empty'; depth: number }
const joinPath = (a: string, b: string) => a.replace(/\/+$/, '') + '/' + b

async function dirRows($: EngineInterface, root: string, open: string[]): Promise<{ rows: DirRow[]; isCut: boolean; rootFiles: number }> {
  const rows: DirRow[] = []
  let isCut = false
  const top = await listDir($, root)
  const walk = async (path: string, listing: Listing, depth: number): Promise<void> => {
    for (const name of listing.dirs) {
      if (rows.length >= DIR_ROWS_MAX) {
        isCut = true
        return
      }
      const child = joinPath(path, name)
      const isOpen = open.includes(child)
      if (!isOpen) {
        rows.push({ kind: 'dir', path: child, name, depth, isOpen, files: 0 })
        continue
      }
      const inner = await listDir($, child)
      rows.push({ kind: 'dir', path: child, name, depth, isOpen, files: inner.files })
      if (inner.dirs.length === 0 && inner.fileNames.length === 0) rows.push({ kind: 'empty', depth: depth + 1 })
      else await walk(child, inner, depth + 1)
      if (isCut) return
    }
    for (const name of listing.fileNames) {
      if (rows.length >= DIR_ROWS_MAX) {
        isCut = true
        return
      }
      rows.push({ kind: 'file', path: joinPath(path, name), name, depth })
    }
  }
  await walk(root, top, 0)
  return { rows, isCut, rootFiles: top.files }
}

// ---------------------------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------------------------

const SPACER =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 8" width="4" height="8"><rect width="4" height="8" fill="#ffffff" fill-opacity="0"/></svg>'
const TILE_COLORS = ['#C8553D', '#238B7E', '#4F52C9', '#B03A6E', '#B7791F', '#35506F', '#7B4DC4', '#2A8451']
const FONT = '-apple-system, Helvetica, Arial, sans-serif'

function tileSvg(name: string, count: number): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const color = TILE_COLORS[h % TILE_COLORS.length]!
  const letter = esc((name[0] ?? '?').toUpperCase())
  const badge = count > 99 ? '99+' : String(count)
  const bw = badge.length > 2 ? 20 : badge.length > 1 ? 16 : 14
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 40" width="44" height="40">` +
    `<rect x="2" y="6" width="36" height="32" rx="9" fill="${color}"/>` +
    `<text x="20" y="29" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="700" fill="#ffffff">${letter}</text>` +
    `<rect x="${42 - bw}" y="1" width="${bw}" height="14" rx="7" fill="#1F2937"/>` +
    `<text x="${42 - bw / 2}" y="11.4" text-anchor="middle" font-family="${FONT}" font-size="9" font-weight="700" fill="#ffffff">${badge}</text>` +
    `</svg>`
  )
}

// ---------------------------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------------------------

const SECTION_ORDER: { id: string; title: string }[] = [
  { id: 'todo', title: 'To-do' },
  { id: 'helpers', title: 'Helpers' },
  { id: 'usage', title: 'Usage' },
  ...MADE_SECTIONS.map(s => ({ id: s.kind as string, title: s.title })),
  { id: 'connectors', title: 'Connectors' },
  { id: 'folder', title: 'Folder' },
  { id: 'files', title: 'Files used' },
  { id: 'skills', title: 'Skills' },
]

// ---------------------------------------------------------------------------------------------
// Starting up: the command, the seed, the first open
// ---------------------------------------------------------------------------------------------

let registered = false
let seeding: Promise<void> | null = null

async function maybeOpen($: EngineInterface): Promise<void> {
  const b = await read($, board)
  if (b.opened || !hasThings(b)) return
  await update($, board, cur => ({ ...cur, opened: true }))
  await $.ui.open({ id: PANE, title: TITLE })
}

async function seed($: EngineInterface): Promise<void> {
  await seedHelpers($)
  const cur = await read($, board)
  if (cur.seeded) return
  const msgs = await $.session.messages()
  let memory: string[] = []
  let skillNames: string[] = []
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    memory = (usage.context.breakdown?.memoryFiles ?? []).map(f => f.path)
    skillNames = (usage.context.breakdown?.skills?.skillFrontmatter ?? []).map(s => s.name)
  } catch {
    // the usage figures are a nice extra
  }
  await update($, board, b => seedBoard(b, msgs, memory, skillNames))
  await ensureClock($)
}

async function init($: EngineInterface): Promise<void> {
  if (!registered) {
    registered = true
    try {
      await $.command.register({
        name: 'everything',
        description: 'Open the side pane that shows everything this chat did',
        immediate: true,
      })
    } catch {
      // The name can be busy for a moment (another mod letting go of it); try again shortly.
      registered = false
      $.clock.after(2000, () => void init($).catch(() => undefined))
    }
  }
  if (!seeding) {
    seeding = seed($)
      .catch(() => undefined)
      .then(() => {
        seeding = null
      })
  }
  await seeding
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      startTicker($)
    } catch {
      // the tick is an extra
    }
    try {
      await init($)
    } catch {
      // a failure here must never break the chat
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const ran = await next(e)
    try {
      await init($)
      await syncHelpers($)
      const cmd = e.command
      if (cmd && !('drop' in ran && ran.drop)) {
        const b = await read($, board)
        if (b.skillNames.includes(cmd.name)) await update($, board, cur => addSkillUse(cur, cmd.name))
      }
    } catch {
      // never break the chat
    }
    return ran
  })

  on('command.run', { command: 'everything' }, async $ => {
    try {
      await $.ui.open({ id: PANE, title: TITLE })
      await update($, board, cur => ({ ...cur, opened: true }))
    } catch {
      // fall through to the text
    }
    return { text: 'Opened the Everything in this chat pane.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      if (ran.deny) return ran
      await init($)
      const { tool, tool_use_id, agentId, requestMeta, ...input } = e as Record<string, unknown>
      void requestMeta
      const now = Number(await $.clock.now())
      const call: Call = {
        id: str(tool_use_id),
        tool: str(tool),
        input,
        result: ran.result,
        text: typeof ran.text === 'string' ? ran.text : undefined,
        isError: ran.isError === true,
        isHelper: typeof agentId === 'string' && agentId !== '',
        time: now,
      }
      const before = (await read($, board)).todo
      await update($, board, b => recordCall(b, call))
      if (!call.isHelper) await trackWork($, before, (await read($, board)).todo)
      try {
        if (!call.isHelper && (call.tool === 'Agent' || call.tool === 'Task')) await update($, helpersAtom, h => addHelper(h, call))
      } catch {
        // the helpers list is an extra
      }
      await syncHelpers($)
      await ensureClock($)
      await maybeOpen($)
    } catch {
      // recording must never break the chat
    }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    try {
      const isDesk = e.surface !== 'terminal'
      const b = await read($, board)
      const folded = await read($, foldedSet)
      const openDirs = await read($, openDirsSet)
      const openApps = await read($, openAppsSet)
      const hs = await liveHelpers($)
      const work = await read($, workAtom)
      const topInfo = workInfo(b.todo, hs, work, Number(await $.clock.now()))
      const now = Number(await $.clock.now())
      const usage = await Promise.resolve($.session.usage()).catch(() => null)
      const kind = await platform($)
      const finder = kind === 'mac' ? 'Finder' : 'Folder'

      const draw = (source: string, alt: string, width: number, height: number) =>
        Svg ? <Svg source={source} alt={alt} width={width} height={height} /> : null
      const gap = () => (isDesk && Svg ? draw(SPACER, 'space', 4, 8) : null)

      const allFolded = SECTION_ORDER.every(s => folded.includes(s.id))

      // One bordered section: a header you can click, then its body.
      const section = (id: string, title: string, right: string, body: any) => {
        const look = LOOK[id] ?? { color: '#6B7280', glyph: '•' }
        const isFolded = folded.includes(id)
        const icon = isDesk && Svg ? iconSvg(id) : ''
        return (
          <Box flexDirection="column">
            <Box key={'sec-box-' + id} flexDirection="column" borderStyle="round" borderColor={look.color} paddingX={1}>
              <Box justifyContent="space-between" alignItems="center">
                <Box alignItems="center" gap={1}>
                  {icon ? draw(icon, title + ' icon', 18, 18) : <Text color={look.color}>{look.glyph}</Text>}
                  <Button key={'sec-' + id} plain onPress={() => void update($, foldedSet, l => toggleIn(l, id))}>
                    <Text bold>{title}</Text>
                    <Text dimColor>{isFolded ? ' ▸' : ' ▾'}</Text>
                  </Button>
                </Box>
                <Text bold color={look.color}>
                  {right}
                </Text>
              </Box>
              {isFolded ? null : <Box flexDirection="column">{body}</Box>}
            </Box>
            {gap()}
          </Box>
        )
      }

      // ---- To-do ----
      const doneCount = b.todo.filter(s => s.status === 'completed').length
      const todoColor = LOOK.todo!.color
      const todoBody =
        b.todo.length === 0 ? (
          <Text dimColor>No to-do list yet</Text>
        ) : (
          b.todo.map((s, i) => (
            <Box key={'t-' + i}>
              <Box width={2}>
                {s.status === 'completed' ? (
                  <Text color="#2E9E5B">✓</Text>
                ) : s.status === 'in_progress' ? (
                  <Text color={todoColor}>●</Text>
                ) : (
                  <Text dimColor>○</Text>
                )}
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text
                  wrap="wrap"
                  bold={s.status === 'in_progress'}
                  dimColor={s.status === 'completed'}
                  strikethrough={s.status === 'completed'}
                >
                  {s.content}
                </Text>
              </Box>
            </Box>
          ))
        )

      // ---- Usage ----
      const usageColor = LOOK.usage!.color
      const meters: { label: string; pct: number; note: string }[] = []
      const ctxPct = usage?.context?.percent
      if (typeof ctxPct === 'number') meters.push({ label: 'Chat memory', pct: ctxPct, note: ctxPct >= 80 ? 'time for a handoff soon' : '' })
      for (const r of usage?.rateLimits ?? []) {
        if (typeof r.percentUsed !== 'number') continue
        meters.push({ label: limitName(String(r.kind)), pct: r.percentUsed, note: resetWords(r.resetsAt, now) })
      }
      const meterW = Math.max(200, Math.max(20, Number(e.props.bodyColumns) || 60) * 10)
      const usageBody =
        meters.length === 0 ? (
          <Text dimColor>No usage numbers yet</Text>
        ) : (
          <Box flexDirection="column">
            {meters.map((m, i) => {
              const pct = Math.max(0, Math.min(100, m.pct))
              const c = pct >= 80 ? '#D64545' : usageColor
              return (
                <Box key={'um-' + i} flexDirection="column">
                  <Box justifyContent="space-between">
                    <Text wrap="truncate-end">{m.label}</Text>
                    <Text color={c}>{Math.round(m.pct) + '%'}</Text>
                  </Box>
                  {isDesk && Svg ? (
                    <Svg source={barSvg(pct, 100, c, meterW)} alt={m.label + ' ' + Math.round(m.pct) + ' percent'} />
                  ) : (
                    <Text color={c}>{textBar(pct, 100, 30)}</Text>
                  )}
                  {m.note ? <Text dimColor wrap="truncate-end">{m.note}</Text> : null}
                </Box>
              )
            })}
          </Box>
        )
      const usageRight = typeof ctxPct === 'number' ? Math.round(ctxPct) + '%' : meters.length ? Math.round(meters[0]!.pct) + '%' : '-'

      // ---- Helpers ----
      const helperColor = LOOK.helpers!.color
      const helperRows = [...hs.list].sort((x, y) => y.seq - x.seq)
      const helperShown = helperRows.slice(0, HELPERS_SHOWN)
      const workingCount = helperRows.filter(x => x.status === 'working').length
      const helpersBody =
        helperRows.length === 0 ? (
          <Text dimColor>No helpers yet</Text>
        ) : (
          <Box flexDirection="column">
            {helperShown.map((hp, i) => (
              <Box key={'hr-' + i} alignItems="center" height={1}>
                <Box flexGrow={1} flexShrink={1} overflow="hidden">
                  <Text wrap="truncate-end">{hp.desc}</Text>
                </Box>
                <Box alignItems="center" gap={1} flexShrink={0} marginLeft={1}>
                  {Svg ? (
                    draw(modelChipSvg(hp.model), hp.model, 56, 18)
                  ) : (
                    <Text bold color={modelColor(hp.model)}>
                      {hp.model}
                    </Text>
                  )}
                  {hp.status === 'working' ? (
                    <Text color={helperColor}>working</Text>
                  ) : hp.status === 'failed' ? (
                    <Text color="#D64545">failed</Text>
                  ) : (
                    <Text dimColor>done</Text>
                  )}
                  <Text dimColor>{hhmm(hp.at)}</Text>
                </Box>
              </Box>
            ))}
            {helperRows.length > helperShown.length ? <Text dimColor>{'+' + (helperRows.length - helperShown.length) + ' more'}</Text> : null}
          </Box>
        )

      // ---- Made / changed / sent / artifacts ----
      const madeSection = (kindId: Item['kind'], title: string) => {
        const rows = b.items
          .map((it, idx) => ({ it, idx }))
          .filter(r => r.it.kind === kindId)
          .sort((x, y) => y.it.seq - x.it.seq)
        const shown = rows.slice(0, MADE_SHOWN)
        const body =
          rows.length === 0 ? (
            <Text dimColor>Nothing yet</Text>
          ) : (
            <Box flexDirection="column">
              {shown.map(({ it, idx }) => {
                const tag = tagOf(it)
                const parent = it.kind === 'artifact' ? '' : parentOf(it.target)
                return (
                  <Box key={'mr-' + idx} flexDirection="column" marginBottom={isDesk ? 1 : 0}>
                    <Box alignItems="center" gap={1} overflow="hidden">
                      <Box flexShrink={0}>
                        {Svg ? draw(chipSvg(tag), tag, 32, 13) : <Text color={chipColor(tag)}>{'[' + tag + ']'}</Text>}
                      </Box>
                      <Box flexShrink={1} overflow="hidden">
                        <Button key={'o-' + idx} plain onPress={() => void openTarget($, it.target, it.label)}>
                          <Text wrap="truncate-end">{it.label}</Text>
                        </Button>
                      </Box>
                    </Box>
                    <Box alignItems="center" gap={1} overflow="hidden">
                      <Box flexGrow={1} flexShrink={1} overflow="hidden">
                        <Text dimColor wrap="truncate-end">
                          {(parent ? '…/' + parent + '  ' : '') + '×' + it.count + '  ' + hhmm(it.at)}
                        </Text>
                      </Box>
                      {it.kind === 'artifact' ? null : (
                        <Box flexShrink={0}>
                          <Button key={'mf-' + idx} plain onPress={() => void showInFinder($, it.target, it.label)}>
                            <Text dimColor>{finder}</Text>
                          </Button>
                        </Box>
                      )}
                    </Box>
                  </Box>
                )
              })}
              {rows.length > shown.length ? <Text dimColor>{'+' + (rows.length - shown.length) + ' more'}</Text> : null}
            </Box>
          )
        return section(kindId, title, String(rows.length), body)
      }

      // ---- Connectors ----
      const connColor = LOOK.connectors!.color
      const openList = (a: AppUse, i: number) => (
        <Box key={'cl-' + i} flexDirection="column" marginTop={1}>
          <Text bold color={connColor}>
            {a.name}
          </Text>
          {[...a.calls].reverse().map((c, j) => (
            <Box key={'cc-' + i + '-' + j} justifyContent="space-between">
              <Box flexShrink={1} gap={1}>
                <Text>{c.words}</Text>
                <Text dimColor wrap="truncate-end">
                  {c.arg}
                </Text>
              </Box>
              <Text dimColor>{hhmm(c.at)}</Text>
            </Box>
          ))}
        </Box>
      )
      const connBody =
        b.apps.length === 0 ? (
          <Text dimColor>None used yet</Text>
        ) : (
          <Box flexDirection="column">
            {Svg ? (
              <Box flexDirection="row" flexWrap="wrap">
                {b.apps.map((a, i) => (
                  <Box key={'ct-' + i} width={12} flexDirection="column" alignItems="center">
                    {draw(tileSvg(a.name, a.count), a.name + ', ' + a.count + ' calls', 44, 40)}
                    <Button key={'c-' + i} plain onPress={() => void update($, openAppsSet, l => toggleIn(l, a.name))}>
                      <Text bold={openApps.includes(a.name)}>{a.name}</Text>
                    </Button>
                  </Box>
                ))}
              </Box>
            ) : (
              b.apps.map((a, i) => (
                <Box key={'ct-' + i} justifyContent="space-between">
                  <Button key={'c-' + i} plain onPress={() => void update($, openAppsSet, l => toggleIn(l, a.name))}>
                    <Text bold={openApps.includes(a.name)}>{a.name}</Text>
                  </Button>
                  <Text bold color={connColor}>
                    {String(a.count)}
                  </Text>
                </Box>
              ))
            )}
            {b.apps.map((a, i) => (openApps.includes(a.name) ? openList(a, i) : null))}
          </Box>
        )

      // ---- Folder ----
      const root = await $.session.root()
      const rootName = nameOf(root)
      const folderColor = LOOK.folder!.color
      const tree = await dirRows($, root, openDirs)
      const folderBody = (
        <Box flexDirection="column">
          <Box alignItems="center" gap={1}>
            <Text bold>{rootName}</Text>
            <Text dimColor>{tree.rootFiles + (tree.rootFiles === 1 ? ' file' : ' files')}</Text>
            <Button key="fo-0" plain onPress={() => void openTarget($, root, rootName)}>
              {finder}
            </Button>
          </Box>
          {tree.rows.map((r, i) =>
            r.kind === 'empty' ? (
              <Box key={'de-' + i} paddingLeft={r.depth * 2}>
                <Text dimColor>Empty folder</Text>
              </Box>
            ) : r.kind === 'file' ? (
              <Box key={'dfr-' + i} paddingLeft={r.depth * 2 + 2} overflow="hidden">
                <Button key={'df-' + i} plain onPress={() => void openTarget($, r.path, r.name)}>
                  <Text wrap="truncate-end">{r.name}</Text>
                </Button>
              </Box>
            ) : (
              <Box key={'dr-' + i} paddingLeft={r.depth * 2} alignItems="center" gap={1}>
                <Button key={'d-' + i} plain onPress={() => void update($, openDirsSet, l => toggleIn(l, r.path))}>
                  <Text color={folderColor}>{r.isOpen ? '▾ ' : '▸ '}</Text>
                  {r.name}
                </Button>
                {r.isOpen ? <Text dimColor>{r.files + (r.files === 1 ? ' file' : ' files')}</Text> : null}
                {r.isOpen ? (
                  <Button key={'fo-' + (i + 1)} plain onPress={() => void openTarget($, r.path, r.name)}>
                    {finder}
                  </Button>
                ) : null}
              </Box>
            ),
          )}
          {tree.isCut ? <Text dimColor>Close a folder to see more</Text> : null}
        </Box>
      )

      // ---- Files used ----
      const autoSet = new Set(b.memory)
      const readRows = [...b.reads].sort((x, y) => y.seq - x.seq).map(r => ({ path: r.path, isAuto: autoSet.has(r.path) }))
      const readPaths = new Set(readRows.map(r => r.path))
      const fileRows = [...readRows, ...b.memory.filter(p => !readPaths.has(p)).map(p => ({ path: p, isAuto: true }))]
      const filesShown = fileRows.slice(0, FILES_SHOWN)
      const filesBody =
        fileRows.length === 0 ? (
          <Text dimColor>Nothing yet</Text>
        ) : (
          <Box flexDirection="column">
            {filesShown.map((f, i) => {
              const parent = parentOf(f.path)
              return (
                <Box key={'fr-' + i} justifyContent="space-between">
                  <Button key={'f-' + i} plain onPress={() => void openTarget($, f.path, nameOf(f.path))}>
                    {nameOf(f.path)}
                    <Text dimColor>{parent ? '  …/' + parent : ''}</Text>
                  </Button>
                  {f.isAuto ? <Text color={LOOK.sent!.color}>auto</Text> : null}
                </Box>
              )
            })}
            {fileRows.length > filesShown.length ? (
              <Text dimColor>{'+' + (fileRows.length - filesShown.length) + ' more'}</Text>
            ) : null}
          </Box>
        )

      // ---- Skills ----
      const skillColor = LOOK.skills!.color
      const skillsBody =
        b.skills.length === 0 ? (
          <Text dimColor>None yet</Text>
        ) : (
          b.skills.map((s, i) => (
            <Box key={'sk-' + i} justifyContent="space-between">
              <Box>
                <Text color={skillColor}>/</Text>
                <Text>{s.name}</Text>
              </Box>
              <Text dimColor>{s.uses + (s.uses === 1 ? ' use' : ' uses')}</Text>
            </Box>
          ))
        )

      return (
        <Box flexDirection="column">
          <Box justifyContent="space-between" alignItems="center">
            <Text dimColor>Click a file or page to open it</Text>
            <Button key="hide" onPress={() => void $.ui.close({ id: PANE })}>
              Hide
            </Button>
          </Box>
          <Box>
            <Box borderStyle="round" borderColor="#9CA3AF" paddingX={1}>
              <Button
                key="fold-all"
                plain
                label={allFolded ? '▾  Open all' : '▴  Collapse all'}
                onPress={() => void update($, foldedSet, () => (allFolded ? [] : SECTION_ORDER.map(s => s.id)))}
              />
            </Box>
          </Box>
          {gap()}
          {workRow(topInfo, { Box, Text, Svg }, isDesk, Number(e.props.bodyColumns))}
          {gap()}
          {section('todo', 'To-do', b.todo.length ? doneCount + ' of ' + b.todo.length : '0', todoBody)}
          {section('helpers', 'Helpers', workingCount ? workingCount + ' working' : String(helperRows.length), helpersBody)}
          {section('usage', 'Usage', usageRight, usageBody)}
          {MADE_SECTIONS.map(s => madeSection(s.kind, s.title))}
          {section('connectors', 'Connectors', String(b.apps.length), connBody)}
          {section('folder', 'Folder', rootName, folderBody)}
          {section('files', 'Files used', String(fileRows.length), filesBody)}
          {section('skills', 'Skills', String(b.skills.length), skillsBody)}
        </Box>
      )
    } catch {
      return <Text dimColor>Could not draw this pane. Try /everything again.</Text>
    }
  })
}
