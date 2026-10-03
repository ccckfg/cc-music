import type { On, RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { PlayerCommand, PlayerSnapshot, Track } from '../types'

const SUNNY: Track = {
  provider: 'bilibili',
  id: 'BV1sunny',
  title: '晴天',
  artists: ['周杰伦'],
  durationSec: 270,
  pageUrl: 'https://www.bilibili.com/video/BV1sunny',
}
const RICE: Track = { ...SUNNY, id: 'BV1rice', title: '稻香', durationSec: 223, pageUrl: 'https://www.bilibili.com/video/BV1rice' }

/** 像用户在提示符里敲 `/music <args>` 那样运行命令 */
function music(args: string) {
  return { command: 'music', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
}

const SESSION = { cwd: 'C:/work', surface: 'terminal', isInteractive: true } as const

const BAND = {
  plugin: 'cc-music',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

function snapshot(fields: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    version: 1,
    status: 'idle',
    current: null,
    index: -1,
    queue: [],
    position: 0,
    duration: null,
    volume: 60,
    repeat: 'off',
    error: null,
    ...fields,
  }
}

/** 一个假的 daemon：桩住会话、env、fs、http，记下 mod 发来的命令，按命令更新状态。 */
function fakeDaemon(on: On): { commands: PlayerCommand[]; searches: string[]; toasts: string[] } {
  const toasts: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__cc-music__${e.name}` } }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  mock.clock(on)
  // 引擎自己画的输入框上方区域：空的
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as RenderElement
  })

  const commands: PlayerCommand[] = []
  const searches: string[] = []
  let player = snapshot()

  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.read', (_$, e) => {
    if (e.path.replaceAll('\\', '/') !=='C:/Users/me/.cc-music/daemon.json') throw new Error(`ENOENT ${e.path}`)
    return { value: JSON.stringify({ pid: 1, port: 4567, token: 'secret', version: '0.1.0', startedAt: '' }) }
  })
  on('http.fetch', (_$, e) => {
    expect(e.init?.headers?.['x-cc-music-token']).toBe('secret')
    const path = new URL(e.url).pathname
    const body = e.init?.body ? (JSON.parse(e.init.body) as Record<string, unknown>) : {}
    let answer: unknown
    switch (path) {
      case '/health':
        answer = { ok: true, pid: 1, version: '0.1.0' }
        break
      case '/providers':
        answer = [
          { id: 'bilibili', name: '哔哩哔哩', aliases: ['bili', 'b'], isDefault: true },
          { id: 'ytmusic', name: 'YouTube Music', aliases: ['yt'], isDefault: false },
        ]
        break
      case '/search':
        searches.push(`${String(body['provider'] ?? '')}|${String(body['query'])}`)
        answer = { provider: String(body['provider'] ?? 'bilibili'), tracks: [SUNNY, RICE] }
        break
      case '/state':
        answer = player
        break
      case '/command': {
        const command = body as PlayerCommand
        commands.push(command)
        if (command.type === 'enqueue' && command.tracks[0]) {
          const queue = [...player.queue, ...command.tracks]
          player = snapshot({ version: player.version + 1, status: 'playing', current: command.tracks[0], index: queue.length - 1, queue, duration: 270, position: 12 })
        } else if (command.type === 'toggle') {
          player = { ...player, version: player.version + 1, status: player.status === 'paused' ? 'playing' : 'paused' }
        } else if (command.type === 'volume') {
          player = { ...player, version: player.version + 1, volume: command.value ?? player.volume + (command.delta ?? 0) }
        }
        answer = player
        break
      }
      default:
        return { value: { status: 404, ok: false, headers: {}, text: JSON.stringify({ error: `没有 ${path}` }) } }
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(answer) } }
  })
  return { commands, searches, toasts }
}

describe('/music 命令', () => {
  test('搜索并立即播放第一个结果，结果列表留给序号使用', async ($, on) => {
    const { commands, searches } = fakeDaemon(on)
    await $.session.start(SESSION)

    const { text } = await $.command.run(music('晴天'))
    expect(text).toContain('正在加载：晴天 — 周杰伦')
    expect(text).toContain(' 2. 稻香')
    expect(searches).toEqual(['|晴天'])
    expect(commands).toEqual([{ type: 'enqueue', tracks: [SUNNY], next: true, play: true }])

    await $.command.run(music('2'))
    expect(commands.at(-1)).toEqual({ type: 'enqueue', tracks: [RICE], next: true, play: true })
  })

  test('音源前缀只认 daemon 报告的音源', async ($, on) => {
    const { searches } = fakeDaemon(on)
    await $.session.start(SESSION)

    await $.command.run(music('search bili:晴天'))
    await $.command.run(music('search Re:Zero'))
    expect(searches).toEqual(['bilibili|晴天', '|Re:Zero'])
  })

  test('控制命令和参数校验', async ($, on) => {
    const { commands } = fakeDaemon(on)
    await $.session.start(SESSION)

    expect((await $.command.run(music('vol +10'))).text).toBe('音量 70')
    await $.command.run(music('seek 1:30'))
    await $.command.run(music('repeat 单曲'))
    expect(commands).toEqual([
      { type: 'volume', delta: 10 },
      { type: 'seek', seconds: 90, relative: false },
      { type: 'repeat', mode: 'one' },
    ])
    expect((await $.command.run(music('vol 很大'))).text).toContain('音量写成')
    expect((await $.command.run(music('3'))).text).toContain('还没有搜索过')
  })
})

test('模型的 music 工具：queue 把最匹配的一首加到队尾', async ($, on) => {
  const { commands } = fakeDaemon(on)
  await $.session.start(SESSION)

  const called = await $.tool.call({ tool: 'mcp__cc-music__music', action: 'queue', query: '稻香 周杰伦' })
  expect(called.deny).toBeUndefined()
  expect(String(called.result)).toContain('已加入队列')
  expect(commands).toEqual([{ type: 'enqueue', tracks: [SUNNY] }])
})

test('迷你播放器：播放时显示曲目，按钮能暂停；空闲时不显示', async ($, on) => {
  fakeDaemon(on)
  await $.session.start(SESSION)

  for (const surface of ['terminal', 'desktop'] as const) {
    const idle = await $.ui.mount({ ...BAND, surface })
    expect(await idle.find({ text: /晴天/ })).toBeUndefined()
    await idle.unmount()
  }

  await $.command.run(music('晴天'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Text', text: '晴天 — 周杰伦' })).toBeDefined()
    expect(await band.find({ key: 'toggle', text: '暂停' })).toBeDefined()
    await band.press({ key: 'toggle' })
    expect(await band.find({ key: 'toggle', text: '播放' })).toBeDefined()
    await band.press({ key: 'toggle' })
    await band.unmount()
  }
})
