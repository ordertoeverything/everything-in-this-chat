// The state contract for the Everything in this chat pane.

export type Item = {
  kind: 'artifact' | 'made' | 'changed' | 'sent'
  target: string
  label: string
  count: number
  seq: number
  at: number
}

export type Step = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  id?: string
}

export type Helper = {
  /** The Agent call's tool_use_id: one row per call. */
  id: string
  /** The helper's own id once known (what a task notification names). */
  agentId: string
  desc: string
  /** The model chip's word: SONNET, HAIKU, OPUS, FABLE or SAME. */
  model: string
  /** True when it was launched in the background. */
  bg: boolean
  status: 'working' | 'done' | 'failed'
  /** Start time in ms; 0 when unknown (seeded from history). */
  at: number
  seq: number
}

export type Helpers = {
  list: Helper[]
  seeded: boolean
}

/** Times behind the work status bar. All in ms; 0 means not started. */
export type Work = {
  /** When the current to-do list started (first seen live, or seed time). */
  listStart: number
  /** The time each step became completed, live only, since the list started. */
  doneAt: number[]
  /** When the current group of working helpers was first seen. */
  helperStart: number
}

export type AppCall = { words: string; arg: string; at: number }
export type AppUse = { name: string; count: number; calls: AppCall[] }
export type FileUse = { path: string; seq: number }
export type SkillUse = { name: string; uses: number }

export type Board = {
  todo: Step[]
  items: Item[]
  apps: AppUse[]
  reads: FileUse[]
  skills: SkillUse[]
  memory: string[]
  skillNames: string[]
  seen: string[]
  seq: number
  seeded: boolean
  opened: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'everything-in-this-chat': {
      board: Shaped<Board>
      helpers: Shaped<Helpers>
      work: Shaped<Work>
      folded: string[]
      openDirs: string[]
      openApps: string[]
    }
  }
}
