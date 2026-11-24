import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'everything-in-this-chat',
  component: 'Pane',
  requestId: 'everything-in-this-chat',
  props: {
    title: 'Everything in this chat',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const use = (tool: string, input: Record<string, unknown>, text = 'ok') => ({
  tool_use_id: 'id-' + tool + '-' + JSON.stringify(input).length,
  tool,
  input,
  text,
})

const agentUse = (id: string, input: Record<string, unknown>, result?: Record<string, unknown>) => ({
  tool_use_id: id,
  tool: 'Agent',
  input,
  ...(result ? { result, text: JSON.stringify(result), agentId: String(result.agentId ?? '') || undefined } : {}),
})

const MESSAGES = [
  { role: 'user', text: '<command-name>/molly</command-name>', toolUses: [] },
  {
    role: 'assistant',
    text: '',
    toolUses: [
      use('mcp__ccd_turn__update_plan', {
        scope: 'first_task',
        items: [
          { content: 'Read the folder', status: 'completed' },
          { content: 'Build the pane', status: 'in_progress' },
          { content: 'Check it works', status: 'pending' },
        ],
      }),
      use('mcp__ccd_turn__update_plan', { advance: true }),
      use('Write', { file_path: '/Users/x/Claude/Pages/hello.html' }),
      use('Edit', { file_path: '/Users/x/Claude/notes.md' }),
      use('SendUserFile', { files: ['/Users/x/Claude/Pages/report.pdf'] }),
      use('Artifact', { action: 'publish', title: 'My page' }, 'Published https://claude.ai/artifact/abc123'),
      use('mcp__00000000-0000-4000-8000-000000000001__notion-search', { query: 'tasks' }),
      use('mcp__gohighlevel__contacts_get-contacts', { query: 'Pat' }),
      use('Bash', { command: 'composio execute GMAIL_SEND_EMAIL -d {}' }),
      use('Read', { file_path: '/Users/x/Claude/Projects/plan.md' }),
      use('Read', { file_path: '/Users/x/.claude/skills/molly/SKILL.md' }),
      use('Skill', { skill: 'handoff' }),
      // a helper that ran to the end, a background one that later finished, and one still going
      agentUse('ag-sync', { description: 'Read the notes', prompt: 'Read them', model: 'haiku' }, { status: 'completed', prompt: 'Read them' }),
      agentUse('ag-bg', { description: 'Build the page', prompt: 'Build', model: 'sonnet', run_in_background: true }, { status: 'async_launched', agentId: 'bgdone1', description: 'Build the page', prompt: 'Build', outputFile: '/tmp/x' }),
      agentUse('ag-run', { prompt: 'Check every link on the site and report the broken ones', run_in_background: true }, { status: 'async_launched', agentId: 'bgrun2', description: 'x', prompt: 'x', outputFile: '/tmp/y' }),
    ],
  },
  {
    role: 'user',
    text: '<task-notification>\n<task-id>bgdone1</task-id>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>',
    toolUses: [],
  },
]

const ENTRIES: Record<string, { name: string; kind: 'file' | 'dir' }[]> = {
  '/Users/x/Claude': [
    { name: 'Projects', kind: 'dir' },
    { name: 'Pages', kind: 'dir' },
    { name: '.git', kind: 'dir' },
    { name: 'voice.md', kind: 'file' },
  ],
  '/Users/x/Claude/Projects': [
    { name: 'Alpha', kind: 'dir' },
    { name: 'plan.md', kind: 'file' },
  ],
}

for (const surface of ['desktop', 'terminal'] as const) {
  test('the pane draws every section on ' + surface, async ($, on) => {
    on('command.register', () => ({ value: { command: 'everything' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.close', () => ({ value: undefined }))
    on('ui.toast', () => ({ value: undefined }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.messages', () => ({ value: MESSAGES as never }))
    on('session.root', () => ({ value: '/Users/x/Claude' }))
    on('session.usage', () => ({
      value: {
        context: {
          breakdown: {
            memoryFiles: [{ path: '/Users/x/.claude/CLAUDE.md', type: 'User', tokens: 10 }],
            skills: { skillFrontmatter: [{ name: 'molly' }, { name: 'handoff' }] },
          },
        },
      } as never,
    }))
    on('fs.list', (_, e) => ({ value: (ENTRIES[String((e as { path?: string }).path)] ?? []) as never }))
    on('process.run', () => ({ value: { exitCode: 0, stdout: 'Darwin\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('clock.now', () => ({ value: 1_700_000_000_000 }))

    await $.session.start({ cwd: '/Users/x/Claude', surface, isInteractive: true })

    const ui = await $.ui.mount({ ...PANE, surface })
    // A new chat starts with every section closed; open them all to look inside.
    expect(await ui.find({ type: 'Button', key: 'o-0' })).toBeFalsy()
    await ui.press({ key: 'fold-all' })

    expect(await ui.find({ type: 'Text', text: /Could not draw/ })).toBeFalsy()
    // To-do: two of three steps are done after the "advance".
    expect(await ui.find({ type: 'Text', text: /2 of 3/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Build the pane/ })).toBeTruthy()
    // Files made, changed, sent and the artifact each hold their row.
    expect(await ui.find({ type: 'Button', key: 'o-0' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'o-3' })).toBeTruthy()
    // Helpers: three rows, one still working.
    expect(await ui.find({ type: 'Text', text: /Build the page/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Read the notes/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Check every link/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /1 working/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /working$/ })).toBeTruthy()
    // A Finder button on file rows, none on the artifact.
    expect(await ui.find({ type: 'Button', key: 'mf-0' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'mf-3' })).toBeFalsy()
    await ui.press({ key: 'mf-0' })
    // A connector call group, the files read, the skills.
    expect(await ui.find({ type: 'Button', key: 'c-0' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'c-2' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'c-3' })).toBeFalsy()
    expect(await ui.find({ type: 'Button', key: 'f-0' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /handoff/ })).toBeTruthy()
    // The folder: the root, its subfolders A to Z, and an opened one.
    expect(await ui.find({ type: 'Text', text: /Claude/ })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'd-0' })).toBeTruthy()
    await ui.press({ key: 'd-1' })
    expect(await ui.find({ type: 'Text', text: /Alpha|1 file/ })).toBeTruthy()
    // Fold everything, then open it again.
    await ui.press({ key: 'fold-all' })
    expect(await ui.find({ type: 'Button', key: 'sec-todo' })).toBeTruthy()
    await ui.press({ key: 'fold-all' })
    await ui.press({ key: 'c-0' })
    expect(await ui.find({ type: 'Text', text: /notion search/ })).toBeTruthy()
    await ui.press({ key: 'hide' })
    await ui.unmount()
  })
}

test('an empty chat shows the empty words', async ($, on) => {
  on('session.root', () => ({ value: '/Users/x/Claude' }))
  on('fs.list', () => ({ value: [] as never }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'Darwin\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'fold-all' })
  expect(await ui.find({ type: 'Text', text: /No to-do list yet/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /None used yet/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /No helpers yet/ })).toBeTruthy()
  await ui.unmount()
})

// ---------------------------------------------------------------------------------------------
// The work status bar above the prompt
// ---------------------------------------------------------------------------------------------

const T0 = 1_700_000_000_000
const MIN = 60_000

function quietHooks(on: any, messages: unknown[], clock: { now: number }, usage: unknown = { context: { breakdown: {} } }) {
  on('command.register', () => ({ value: { command: 'everything' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: messages as never }))
  on('session.root', () => ({ value: '/Users/x/Claude' }))
  on('session.usage', () => ({ value: usage as never }))
  on('fs.list', () => ({ value: [] as never }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'Darwin\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('clock.now', () => ({ value: clock.now }))
  on('clock.every', () => ({ value: undefined }))
}

for (const surface of ['desktop', 'terminal'] as const) {
  test('the pane status bar shows the step and a time left on ' + surface, async ($, on) => {
    const clock = { now: T0 }
    quietHooks(on, [], clock)
    on('tool.call', () => ({ result: {}, text: 'ok' }) as never)
    await $.session.start({ cwd: '/Users/x/Claude', surface, isInteractive: true })

    await $.tool.call({
      tool: 'mcp__ccd_turn__update_plan',
      items: [
        { content: 'Read the folder', status: 'completed' },
        { content: 'Build the pane', status: 'in_progress' },
        { content: 'Check it works', status: 'pending' },
        { content: 'Write it up', status: 'pending' },
      ],
    } as never)

    const before = await $.ui.mount({ ...PANE, surface })
    await before.press({ key: 'fold-all' })
    expect(await before.find({ type: 'Text', text: /Step 2 of 4 · estimate after step 1 · just started/ })).toBeTruthy()
    await before.unmount()

    clock.now = T0 + 3 * MIN
    await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as never)
    clock.now = T0 + 4 * MIN

    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'fold-all' })
    expect(await ui.find({ type: 'Text', text: /Step 3 of 4 · about 6 min left · 4 min in/ })).toBeTruthy()
    if (surface === 'desktop') expect(await ui.find({ type: 'Svg' })).toBeTruthy()
    await ui.unmount()
  })

  test('the pane has no status bar when every step is done on ' + surface, async ($, on) => {
    const clock = { now: T0 }
    quietHooks(on, [], clock)
    on('tool.call', () => ({ result: {}, text: 'ok' }) as never)
    await $.session.start({ cwd: '/Users/x/Claude', surface, isInteractive: true })
    await $.tool.call({
      tool: 'mcp__ccd_turn__update_plan',
      items: [
        { content: 'One', status: 'completed' },
        { content: 'Two', status: 'completed' },
      ],
    } as never)

    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'fold-all' })
    expect(await ui.find({ type: 'Text', text: /Step \d of/ })).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: / left$/ })).toBeFalsy()
    await ui.unmount()
  })

  test('the pane status line counts a working helper with no to-do on ' + surface, async ($, on) => {
    const clock = { now: T0 }
    const msgs = [
      {
        role: 'assistant',
        text: '',
        toolUses: [
          agentUse('ag-live', { description: 'Check the links', prompt: 'Check', run_in_background: true }, { status: 'async_launched', agentId: 'live1' }),
        ],
      },
    ]
    quietHooks(on, msgs, clock)
    await $.session.start({ cwd: '/Users/x/Claude', surface, isInteractive: true })

    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'fold-all' })
    expect(await ui.find({ type: 'Text', text: /^1 helper working · / })).toBeTruthy()
    if (surface === 'desktop') expect(await ui.find({ type: 'Svg' })).toBeTruthy()
    else expect(await ui.find({ type: 'Text', text: /▰/ })).toBeTruthy()
    await ui.unmount()
  })

  test('the pane shows Claude working mid-reply with no to-do, then goes quiet on ' + surface, async ($, on) => {
    const clock = { now: T0 }
    quietHooks(on, [], clock)
    on('turn.start', (_: unknown, e: { turnId?: string }) => ({ turnId: e.turnId ?? 't1' }))
    on('turn.complete', () => ({ text: 'done' }))
    await $.session.start({ cwd: '/Users/x/Claude', surface, isInteractive: true })

    // A helper's own turn does not count as Claude working.
    await $.turn.start({ text: '', turnId: 'h1', agentId: 'helper1' })
    const idle = await $.ui.mount({ ...PANE, surface })
    expect(await idle.find({ type: 'Text', text: /Nothing running right now/ })).toBeTruthy()
    await idle.unmount()

    await $.turn.start({ text: 'fix it', turnId: 't1' })
    clock.now = T0 + 2 * MIN
    const busy = await $.ui.mount({ ...PANE, surface })
    expect(await busy.find({ type: 'Text', text: /^Claude is working · 2 min in$/ })).toBeTruthy()
    if (surface === 'desktop') expect(await busy.find({ type: 'Svg' })).toBeTruthy()
    else expect(await busy.find({ type: 'Text', text: /▰/ })).toBeTruthy()
    await busy.unmount()

    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    const after = await $.ui.mount({ ...PANE, surface })
    expect(await after.find({ type: 'Text', text: /Nothing running right now/ })).toBeTruthy()
    await after.unmount()
  })

  test('the working clock keeps counting across back-to-back turns on ' + surface, async ($, on) => {
    const clock = { now: T0 }
    quietHooks(on, [], clock)
    on('turn.start', (_: unknown, e: { turnId?: string }) => ({ turnId: e.turnId ?? 't1' }))
    on('turn.complete', () => ({ text: 'done' }))
    await $.session.start({ cwd: '/Users/x/Claude', surface, isInteractive: true })

    await $.turn.start({ text: 'fix it', turnId: 't1' })
    // A second start with no end in between keeps the first time.
    clock.now = T0 + 1 * MIN
    await $.turn.start({ text: '', turnId: 't2' })
    // The app ends a turn and starts another on its own a few seconds later.
    clock.now = T0 + 2 * MIN
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    clock.now = T0 + 2 * MIN + 5000
    await $.turn.start({ text: '', turnId: 't3' })
    clock.now = T0 + 5 * MIN
    const busy = await $.ui.mount({ ...PANE, surface })
    expect(await busy.find({ type: 'Text', text: /^Claude is working · 5 min in$/ })).toBeTruthy()
    await busy.unmount()

    // After a real pause, a new turn starts the clock over.
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer' })
    clock.now = T0 + 20 * MIN
    await $.turn.start({ text: 'next', turnId: 't4' })
    clock.now = T0 + 20 * MIN + 10000
    const fresh = await $.ui.mount({ ...PANE, surface })
    expect(await fresh.find({ type: 'Text', text: /^Claude is working · just started$/ })).toBeTruthy()
    await fresh.unmount()

    // The first minute counts up in 15 second steps.
    clock.now = T0 + 20 * MIN + 40000
    const secs = await $.ui.mount({ ...PANE, surface })
    expect(await secs.find({ type: 'Text', text: /^Claude is working · 30 sec in$/ })).toBeTruthy()
    await secs.unmount()
  })

  test('the working clock keeps counting when Claude remakes the to-do list mid-work on ' + surface, async ($, on) => {
    const clock = { now: T0 }
    quietHooks(on, [], clock)
    on('turn.start', (_: unknown, e: { turnId?: string }) => ({ turnId: e.turnId ?? 't1' }))
    on('turn.complete', () => ({ text: 'done' }))
    on('tool.call', () => ({ result: {}, text: 'ok' }) as never)
    on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }) as never)
    await $.session.start({ cwd: '/Users/x/Claude', surface, isInteractive: true })

    await $.turn.start({ text: 'build it', turnId: 't1' })
    await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }] } as never)
    clock.now = T0 + 6 * MIN
    // A brand new list, mid-work.
    await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: 'C', status: 'in_progress' }, { content: 'D', status: 'pending' }] } as never)
    // The person types a note while Claude is still working.
    await $.prompt.submit({ text: 'note the time' } as never)
    clock.now = T0 + 9 * MIN
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Step 1 of 2 · estimate after step 1 · 9 min in$/ })).toBeTruthy()
    // Nothing done yet, but the bar still shows a moving piece while Claude works.
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /▰/ })).toBeTruthy()
    await ui.unmount()
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test('helper status follows the engine agent list on ' + surface, async ($, on) => {
    const clock = { now: T0 }
    const launch = (id: string, name: string, agentId: string) =>
      agentUse(id, { description: name, prompt: name, model: 'sonnet', run_in_background: true }, { status: 'async_launched', agentId })
    const msgs = [
      {
        role: 'assistant',
        text: '',
        toolUses: [
          launch('a1', 'Finished helper', 'done1'),
          launch('a2', 'Running helper with a very long description that would push the chip off the right edge of the pane', 'run1'),
          launch('a3', 'Broken helper', 'fail1'),
          launch('a4', 'Vanished helper', 'gone1'),
        ],
      },
    ]
    quietHooks(on, msgs, clock)
    on('agent.list', () => ({
      value: [
        { id: 'done1', status: 'completed' },
        { id: 'run1', status: 'running' },
        { id: 'fail1', status: 'failed' },
      ] as never,
    }))
    await $.session.start({ cwd: '/Users/x/Claude', surface, isInteractive: true })

    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'fold-all' })
    expect(await ui.find({ type: 'Text', text: /^1 working$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^failed$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^done$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Running helper with a very long/ })).toBeTruthy()
    await ui.unmount()

  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test('the usage section shows chat memory and plan limits on ' + surface, async ($, on) => {
    const clock = { now: Date.parse('2026-11-18T12:00:00Z') }
    quietHooks(on, [], clock, {
        startedAt: clock.now,
        context: { window: 200000, tokens: 90000, percent: 45 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 82, resetsAt: '2026-11-18T14:30:00Z' },
          { kind: 'seven_day', percentUsed: 30, resetsAt: '2026-11-21T09:00:00Z' },
        ],
        cost: { usd: 3.21 },
      })
    await $.session.start({ cwd: '/Users/x/Claude', surface, isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'fold-all' })
    expect(await ui.find({ type: 'Text', text: /^Chat memory$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^5-hour limit$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^Weekly limit$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^82%$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^resets / })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /\$|3\.21/ })).toBeFalsy()
    await ui.unmount()
  })
}
