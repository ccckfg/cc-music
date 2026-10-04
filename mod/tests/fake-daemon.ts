import type { On, RenderElement } from 'claude-code'
import { expect, mock } from 'claude-code/testing'

import type { ConfigPatch, ConfigResponse, LibraryResponse, PlayerCommand, PlayerSnapshot, Track } from '../types'
import { DAEMON_VERSION } from '../hooks/daemon.ts'

export const SUNNY: Track = {
  provider: 'bilibili',
  id: 'BV1sunny',
  title: '晴天',
  artists: ['周杰伦'],
  durationSec: 270,
  pageUrl: 'https://www.bilibili.com/video/BV1sunny',
}
export const RICE: Track = { ...SUNNY, id: 'BV1rice', title: '稻香', durationSec: 223, pageUrl: 'https://www.bilibili.com/video/BV1rice' }

/** 像用户在提示符里敲 `/music <args>` 那样运行命令 */
export function music(args: string, presentation: { isFullscreen: boolean; columns: number } = MAIN_SCREEN) {
  return { command: 'music', args, origin: { kind: 'composer' }, presentation } as const
}

/** 主屏幕布局：面板只能放在输入框上方 */
export const MAIN_SCREEN = { isFullscreen: false, columns: 120 }
/** 全屏布局、终端够宽：面板停靠成侧边栏 */
export const FULLSCREEN = { isFullscreen: true, columns: 160 }

export const SESSION = { cwd: 'C:/work', surface: 'terminal', isInteractive: true } as const

export const BAND = {
  plugin: 'cc-music',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

export function snapshot(fields: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
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
export const PANE = {
  plugin: 'cc-music',
  component: 'Pane',
  requestId: 'cc-music',
  props: { title: 'cc-music', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

/** 2×2 像素的“封面”：红 绿 / 蓝 白，每个像素 R、G、B 三字节，base64 */
export const COVER_PIXELS = '/wAAAP8AAAD/////'

export type FakeDaemon = {
  commands: PlayerCommand[];
  searches: string[];
  toasts: string[];
  /** 打开过的面板：id、想要的列数、是否要焦点 */
  opened: { id: string; columns: number | undefined; focus: boolean }[];
  library: LibraryResponse;
  clock: ReturnType<typeof mock.clock>;
  /** 设置页发给 daemon 的配置补丁 */
  configPatches: ConfigPatch[];
  /** 插件的 $.store */
  store: Map<string, unknown>;
}

/** 一个假的 daemon：桩住会话、env、fs、http，记下 mod 发来的命令，按命令更新状态。 */
export type FakeOptions = {
  /** 假 daemon 报告的版本 */
  version?: string;
  /** 模拟 cc-music 下面的插件（如 crush-style）在输入框上方画的一行 */
  bandBelow?: string;
  /** 会话开始前 $.store 里已有的内容（上一次会话存下的） */
  store?: Record<string, unknown>;
  /** 让 POST /config 失败，返回这个原因 */
  configError?: string;
}

export function fakeDaemon(on: On, options: FakeOptions = {}): FakeDaemon {
  const version = options.version ?? DAEMON_VERSION
  const toasts: string[] = []
  const opened: FakeDaemon['opened'] = []
  const library: LibraryResponse = { favorites: [], history: [] }
  const store = new Map(Object.entries(options.store ?? {}))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  const configPatches: ConfigPatch[] = []
  let config: ConfigResponse = {
    settings: { defaultProvider: 'bilibili', volume: 60, cookiesFile: '', idleExitMinutes: 30 },
    configFile: 'C:/Users/me/.cc-music/config.json',
    hasCookiesFile: false,
    tools: { mpv: 'C:/scoop/mpv.exe', ytdlp: 'C:/scoop/yt-dlp.exe', ffmpeg: null },
  }
  on('ui.open', (_$, e) => {
    opened.push({ id: e.id, columns: e.columns, focus: e.focus === true })
    return { value: { isPlaced: true } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__cc-music__${e.name}` } }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.close', () => ({ value: undefined }))
  const clock = mock.clock(on)
  // 引擎自己画的输入框上方区域：空的
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    if (e.component === 'AbovePrompt' && options.bandBelow) return h(Text, {}, options.bandBelow) as RenderElement
    return h(Box, {}) as RenderElement
  })

  const commands: PlayerCommand[] = []
  const searches: string[] = []
  let player = snapshot()

  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.read', (_$, e) => {
    if (e.path.replaceAll('\\', '/') !=='C:/Users/me/.cc-music/daemon.json') throw new Error(`ENOENT ${e.path}`)
    return { value: JSON.stringify({ pid: 1, port: 4567, token: 'secret', version, startedAt: '' }) }
  })
  on('http.fetch', (_$, e) => {
    expect(e.init?.headers?.['x-cc-music-token']).toBe('secret')
    const path = new URL(e.url).pathname
    const body = e.init?.body ? (JSON.parse(e.init.body) as Record<string, unknown>) : {}
    let answer: unknown
    switch (path) {
      case '/health':
        answer = { ok: true, pid: 1, version }
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
      case '/lyrics': {
        const track = body['track'] as Track
        answer = { key: `${track.provider}:${track.id}`, synced:[{ time: 0, text: '前奏' }, { time: 10, text: '故事的小黄花' }, { time: 20, text: '从出生那年就飘着' }], plain: null, source: 'fake' }
        break
      }
      case '/cover': {
        const track = body['track'] as Track
        answer = { key: `${track.provider}:${track.id}`, width: 2, height: 2, pixels: COVER_PIXELS }
        break
      }
      case '/library':
        answer = library
        break
      case '/config':
        if (e.init?.method === 'POST') {
          const patch = body as ConfigPatch
          configPatches.push(patch)
          if (options.configError) {
            return { value: { status: 400, ok: false, headers: {}, text: JSON.stringify({ error: options.configError }) } }
          }
          const settings = { ...config.settings, ...patch }
          // 假装只有以 cookies.txt 结尾的文件存在
          config = { ...config, settings, hasCookiesFile: settings.cookiesFile.endsWith('cookies.txt') }
        }
        answer = config
        break
      case '/library/favorite': {
        const track = body['track'] as Track
        library.favorites = library.favorites.filter(t => t.id !== track.id)
        if (body['favorite'] === true) library.favorites.unshift(track)
        answer = library
        break
      }
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
  return { commands, searches, toasts, opened, library, clock, configPatches, store }
}
