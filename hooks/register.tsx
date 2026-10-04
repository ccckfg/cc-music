// cc-music mod 入口：注册 /music 命令和给模型的 music 工具，轮询 daemon，
// 画输入框上方的迷你播放器和 cc-music 面板。
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { PaneTab, PlayerCommand, PlayerSnapshot, Prefs, Track } from '../types'
import * as daemon from './daemon.ts'
import { trackLabel } from './format.ts'
import { errorText, type Host } from './host.ts'
import {
  afterPaneOpened,
  changeSettings,
  DEFAULT_PREFS,
  enqueue,
  loadSettings,
  parsePrefs,
  playNow,
  refreshLibrary,
  restart,
  runMusic,
  runTool,
  searchTracks,
  send,
  syncTrackExtras,
  toggleFavorite,
  type ToolInput,
} from './music.ts'
import type { FxMessage } from './fx/shared.ts'
import { rampFor } from './theme.ts'
import { MiniPlayer, PaneView, type PaneActions } from './view.tsx'

// $.state 里的值：热重载后仍在，画面从这里读。引擎要求它们在使用它们的文件里声明
const playerAtom = atom({ plugin: 'cc-music', key: 'player' } as const, null)
const lastSearchAtom = atom({ plugin: 'cc-music', key: 'lastSearch' } as const, null)
const prefsAtom = atom({ plugin: 'cc-music', key: 'prefs' } as const, DEFAULT_PREFS)
const paneOpenAtom = atom({ plugin: 'cc-music', key: 'isPaneOpen' } as const, false)
const paneTabAtom = atom({ plugin: 'cc-music', key: 'paneTab' } as const, 'now')
const searchAtom = atom({ plugin: 'cc-music', key: 'search' } as const, { query: '', isSearching: false, error: null })
const lyricsAtom = atom({ plugin: 'cc-music', key: 'lyrics' } as const, null)
const coverAtom = atom({ plugin: 'cc-music', key: 'cover' } as const, null)
const libraryAtom = atom({ plugin: 'cc-music', key: 'library' } as const, null)
const daemonVersionAtom = atom({ plugin: 'cc-music', key: 'daemonVersion' } as const, null)
const settingsAtom = atom({ plugin: 'cc-music', key: 'settings' } as const, null)
const themeAtom = atom({ plugin: 'cc-music', key: 'theme' } as const, 'dark')

/** $.store 里存偏好的键 */
const PREFS_KEY = 'prefs'

const COMMAND = 'music'
const TOOL = 'music'
const TOOL_NAME = 'mcp__cc-music__music'
const PANE = 'cc-music'
/** 面板在输入框上方展开时想要的高度 */
const PANE_ROWS = 24
/** 面板停靠成侧边栏时想要的宽度 */
const PANE_COLUMNS = 48
/** 全屏布局下终端至少这么宽，面板才会停靠成侧边栏 */
const SIDEBAR_MIN_COLUMNS = 110

/** 播放中每秒取一次状态；空闲时每 IDLE_EVERY 秒一次 */
const POLL_MS = 1000
const IDLE_EVERY = 5

const TOOL_DESCRIPTION = `控制用户在 Claude Code 里的背景音乐播放器（cc-music）。用户想听歌、点歌、切歌、暂停、调音量、看歌词，或问正在放什么时使用。
- action=play：按 query 搜索并立即播放最匹配的一首；原有队列保留，新歌插在当前歌曲之后
- action=queue：按 query 搜索，把最匹配的一首加到队列末尾。要排好几首歌就多次调用，每次 query 写一首具体的歌
- action=search：只搜索，返回候选列表，不播放
- action=pause / resume / next / prev / stop：播放控制
- action=volume：把音量设为 volume（0–100）
- action=status：当前在放什么、队列里有什么
- action=lyrics：当前歌曲的歌词
- action=favorite：收藏或取消收藏当前歌曲
query 写成“歌名 歌手”最准。provider 可选 bilibili（默认，国内可直接播放）或 ytmusic。`

/** session.start 时用 `$` 建好的宿主能力；模块重载会重新 session.start，重新建。 */
let host: Host | undefined
/** 上一次提示过的曲目和错误，免得每次轮询都弹 toast */
let announcedTrack: string | undefined
let announcedError: string | undefined
let isPolling = false
let ticks = 0

function requireHost(): Host {
  if (!host) throw new Error('cc-music 还没初始化完，请稍后再试')
  return host
}

function isSame(a: PlayerSnapshot | null, b: PlayerSnapshot | null): boolean {
  if (a === null || b === null) return a === b
  return a.version === b.version && Math.floor(a.position) === Math.floor(b.position) && a.duration === b.duration
}

/** 换歌、出错时弹一条 toast。 */
function announce(host: Host, player: PlayerSnapshot | null): void {
  if (player?.status === 'playing' && player.current) {
    const key = `${player.index}:${player.current.provider}:${player.current.id}`
    if (key !== announcedTrack) {
      announcedTrack = key
      host.toast(`♪ 正在播放：${trackLabel(player.current)}`)
    }
  }
  if (player?.status === 'error' && player.error && player.error !== announcedError) {
    announcedError = player.error
    host.toast(`cc-music：${player.error}`, 8000)
  }
}

async function poll(host: Host): Promise<void> {
  ticks += 1
  if (isPolling) return
  const previous = await host.getPlayer()
  const isActive = previous !== null && (previous.status === 'playing' || previous.status === 'loading')
  if (!isActive && ticks % IDLE_EVERY !== 0) return

  isPolling = true
  try {
    const player = await daemon.peekState(host)
    if (!isSame(previous, player)) await host.setPlayer(player)
    await host.setDaemonVersion(player ? ((await daemon.runningVersion(host)) ?? null) : null)
    announce(host, player)
    await syncTrackExtras(host, player)
  } catch (error) {
    host.debug(`轮询失败：${errorText(error)}`)
  } finally {
    isPolling = false
  }
}

/** 按钮背后的动作：失败时用 toast 告诉用户。 */
async function act(task: (host: Host) => Promise<unknown>): Promise<void> {
  const current = host
  if (!current) return
  try {
    await task(current)
  } catch (error) {
    current.toast(`cc-music：${errorText(error)}`)
  }
}

const press = (cmd: PlayerCommand) => act(h => send(h, cmd))

const paneActions: PaneActions = {
  command: cmd => void press(cmd),
  setTab: tab => void act(h => switchTab(h, tab)),
  search: query =>
    void act(async h => {
      const trimmed = query.trim()
      if (!trimmed) return
      await h.setSearch({ query: trimmed, isSearching: true, error: null })
      try {
        await searchTracks(h, trimmed)
        await h.setSearch({ query: trimmed, isSearching: false, error: null })
      } catch (error) {
        await h.setSearch({ query: trimmed, isSearching: false, error: errorText(error) })
      }
    }),
  play: (track: Track) => void act(h => playNow(h, [track])),
  enqueue: (track: Track) =>
    void act(async h => {
      const player = await enqueue(h, [track])
      h.toast(`已加入队列（第 ${player.queue.length} 首）：${trackLabel(track)}`)
    }),
  toggleFavorite: (track: Track) => void act(async h => h.toast(await toggleFavorite(h, track))),
  changeSettings: patch => void act(h => changeSettings(h, patch)),
  changePrefs: patch => void act(h => h.setPrefs(patch)),
  restartDaemon: () =>
    void act(async h => {
      h.toast('正在重启后台播放器…')
      h.toast(await restart(h))
      await loadSettings(h)
    }),
}

/** 告诉用户面板摆在了哪、怎样才能变成侧边栏。 */
function placementNote(isFullscreen: boolean, columns: number): string {
  if (isFullscreen && columns >= SIDEBAR_MIN_COLUMNS) return '已在右侧打开 cc-music 侧边栏。'
  if (isFullscreen) return `已在输入框上方打开面板。终端现在 ${columns} 列，拉宽到 ${SIDEBAR_MIN_COLUMNS} 列以上它会停靠成侧边栏。`
  return '已在输入框上方打开面板。当前是主屏幕布局（设置了 CLAUDE_CODE_NO_FLICKER=0 或在 tmux 里），只有全屏布局才能停靠成侧边栏。'
}

const NEXT_REPEAT: Record<PlayerSnapshot['repeat'], PlayerSnapshot['repeat']> = { off: 'all', all: 'one', one: 'off' }
const PANE_TABS: readonly string[] = ['now', 'search', 'queue', 'favorites', 'history', 'settings']
const PREF_NAMES: readonly string[] = ['showMiniPlayer', 'autoOpenSidebar', 'showCover']

function isPaneTab(value: unknown): value is PaneTab {
  return typeof value === 'string' && PANE_TABS.includes(value)
}

function isPrefName(value: unknown): value is keyof Prefs {
  return typeof value === 'string' && PREF_NAMES.includes(value)
}

async function switchTab(host: Host, tab: PaneTab): Promise<void> {
  await host.setPaneTab(tab)
  if (tab === 'favorites' || tab === 'history') await refreshLibrary(host)
  if (tab === 'settings') await loadSettings(host)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const root = $.plugin.root
    const dataDir = async () => {
      const custom = await $.env.get('CC_MUSIC_HOME')
      if (custom) return custom
      const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
      return `${home}/.cc-music`
    }
    host = {
      fetch: (url, init) => $.http.fetch(url, init),
      readText: path => $.fs.read(path),
      run: (argv, timeoutMs) => $.process.run(argv, { timeoutMs }),
      dataDir,
      launcher: async () => {
        const node = (await $.env.get('CC_MUSIC_NODE')) ?? 'node'
        const configured = await $.env.get('CC_MUSIC_DAEMON')
        if (configured) return { node, script: configured }
        // 仓库根目录就是插件目录，daemon 在它的 daemon/ 下；插件目录可能是链接，先解析真实路径
        const stat = await $.fs.stat(root, { resolve: true }).catch(() => undefined)
        const beside = `${(stat?.realPath ?? root).replace(/[\\/]+$/, '')}/daemon/src/launch.ts`
        if (await $.fs.exists(beside)) return { node, script: beside }
        // 插件被拷到了别处（比如会话的 mods 目录）：用 daemon 上次启动时记下的位置
        try {
          const install = JSON.parse(await $.fs.read(`${await dataDir()}/install.json`)) as { launch?: string }
          if (install.launch) return { node, script: install.launch }
        } catch {
          // 还没有 install.json
        }
        throw new Error(`找不到 cc-music daemon（${beside}）。设置环境变量 CC_MUSIC_DAEMON 指向 daemon/src/launch.ts`)
      },
      sleep: ms => $.clock.sleep(ms),
      getPlayer: () => read($, playerAtom),
      setPlayer: player => update($, playerAtom, () => player).then(() => undefined),
      getLastSearch: () => read($, lastSearchAtom),
      setLastSearch: search => update($, lastSearchAtom, () => search).then(() => undefined),
      getPrefs: () => read($, prefsAtom),
      setPrefs: async patch => {
        const prefs = { ...(await read($, prefsAtom)), ...patch }
        await update($, prefsAtom, () => prefs)
        await $.store.set(PREFS_KEY, prefs)
      },
      getSettings: () => read($, settingsAtom),
      setSettings: settings => update($, settingsAtom, () => settings).then(() => undefined),
      isPaneOpen: () => read($, paneOpenAtom),
      setPaneOpen: isOpen => update($, paneOpenAtom, () => isOpen).then(() => undefined),
      setPaneTab: tab => update($, paneTabAtom, () => tab).then(() => undefined),
      setSearch: search => update($, searchAtom, () => search).then(() => undefined),
      getLyrics: () => read($, lyricsAtom),
      setLyrics: lyrics => update($, lyricsAtom, () => lyrics).then(() => undefined),
      getCover: () => read($, coverAtom),
      setCover: cover => update($, coverAtom, () => cover).then(() => undefined),
      getLibrary: () => read($, libraryAtom),
      setLibrary: library => update($, libraryAtom, () => library).then(() => undefined),
      setDaemonVersion: async version => {
        if ((await read($, daemonVersionAtom)) !== version) await update($, daemonVersionAtom, () => version)
      },
      toast: (text, timeoutMs) => $.ui.toast(text, timeoutMs === undefined ? undefined : { timeoutMs }),
      debug: text => $.ui.log(`cc-music: ${text}`, { to: 'debug' }),
    }

    // 偏好存在 $.store 里，跨会话保留；读不到就用默认值
    const stored = await $.store.get(PREFS_KEY).catch(() => undefined)
    await update($, prefsAtom, () => parsePrefs(stored))
    // 渐变色按主题挑；读不到就当暗色
    const theme = (await $.config.list().catch(() => [])).find(row => row.key === 'theme')?.value
    if (typeof theme === 'string') await update($, themeAtom, () => theme)

    await $.command.register({
      name: COMMAND,
      description: '听音乐：/music 打开面板，/music <歌名> 搜索播放，/music help 查看全部用法',
      argumentHint: '[歌名 | 序号 | pause | next | vol 60 | lyrics | help]',
      immediate: true,
    })
    await $.tool.register({
      name: TOOL,
      description: TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['play', 'queue', 'search', 'pause', 'resume', 'next', 'prev', 'stop', 'volume', 'status', 'lyrics', 'favorite'],
          },
          query: { type: 'string', description: '搜索词，最好是“歌名 歌手”' },
          provider: { type: 'string', enum: ['bilibili', 'ytmusic'] },
          volume: { type: 'number', minimum: 0, maximum: 100 },
        },
        required: ['action'],
      },
    })
    $.clock.every(POLL_MS, () => {
      if (host) void poll(host)
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    try {
      const h = requireHost()
      const reply = await runMusic(h, e.args)
      const { isFullscreen, columns } = e.presentation
      const canDock = isFullscreen && columns >= SIDEBAR_MIN_COLUMNS
      if (reply.pane === 'open' || (reply.pane === 'sidebar' && canDock)) {
        // 必须用这个命令 hook 自己的 `$` 打开：引擎据此认作用户要求的，任何宽度都会摆出来。
        // 明确要面板（/music）时要焦点：别的插件也有侧边栏时（如 crush-style），这样才会切到 cc-music 这一页
        const opened = await $.ui.open({
          id: PANE,
          title: 'cc-music',
          rows: PANE_ROWS,
          columns: PANE_COLUMNS,
          ...(reply.pane === 'open' ? { focus: true as const } : {}),
        })
        if (opened.isPlaced) {
          await afterPaneOpened(h)
          if (reply.pane === 'open') return { text: `${placementNote(isFullscreen, columns)}\n${reply.text}` }
        } else {
          return { text: `面板暂时摆不下：${opened.reason}\n${reply.text}` }
        }
      }
      return { text: reply.text }
    } catch (error) {
      return { text: `cc-music：${errorText(error)}` }
    }
  })

  on('tool.call', { tool: TOOL_NAME }, async (_$, e) => {
    try {
      return { result: await runTool(requireHost(), e as unknown as ToolInput) }
    } catch (error) {
      return { deny: `cc-music：${errorText(error)}` }
    }
  })

  // 用户换主题：渐变色跟着换
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    if (typeof e.value === 'string') await update($, themeAtom, () => e.value as string)
    return result
  })

  // 动效区域（fx/ 下的 Client）里的点击、拖动发来的消息
  on('ui.message', async ($, e, next) => {
    if (!e.module.includes('/fx/')) return next(e)
    const message = e.data as FxMessage
    switch (message.action) {
      case 'tab':
        if (isPaneTab(message.tab)) paneActions.setTab(message.tab)
        break
      case 'prev':
      case 'next':
      case 'toggle':
        paneActions.command({ type: message.action })
        break
      case 'repeat': {
        const player = await read($, playerAtom)
        paneActions.command({ type: 'repeat', mode: NEXT_REPEAT[player?.repeat ?? 'off'] })
        break
      }
      case 'favorite': {
        const track = (await read($, playerAtom))?.current
        if (track) paneActions.toggleFavorite(track)
        break
      }
      case 'seek':
        if (Number.isFinite(message.seconds)) paneActions.command({ type: 'seek', seconds: Math.max(0, message.seconds) })
        break
      case 'volume':
        if (Number.isFinite(message.value)) paneActions.command({ type: 'volume', value: Math.max(0, Math.min(100, Math.round(message.value))) })
        break
      case 'pref':
        if (isPrefName(message.name)) paneActions.changePrefs({ [message.name]: message.value === true })
        break
      case 'restart':
        paneActions.restartDaemon()
        break
    }
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, paneOpenAtom, () => false)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const daemonVersion = await read($, daemonVersionAtom)
    return PaneView(
      {
        Box: kit.Box,
        Text: kit.Text,
        Button: kit.Button,
        ...('Input' in kit ? { Input: kit.Input } : {}),
        ...('Raster' in kit ? { Raster: kit.Raster } : {}),
        ...('Client' in kit ? { Client: kit.Client } : {}),
      },
      {
        columns: e.props.bodyColumns,
        isDocked: e.props.placement === 'dock',
        rows: e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 24,
        tab: await read($, paneTabAtom),
        player: await read($, playerAtom),
        lyrics: await read($, lyricsAtom),
        cover: await read($, coverAtom),
        library: await read($, libraryAtom),
        lastSearch: await read($, lastSearchAtom),
        search: await read($, searchAtom),
        prefs: await read($, prefsAtom),
        settings: await read($, settingsAtom),
        ramp: rampFor(await read($, themeAtom)),
        outdatedDaemon: daemonVersion && daemonVersion !== daemon.DAEMON_VERSION ? daemonVersion : undefined,
      },
      paneActions,
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const player = await read($, playerAtom)
    const prefs = await read($, prefsAtom)
    const track = player?.current
    if (!prefs.showMiniPlayer || !player || !track || player.status === 'idle') return next(e)

    const below = await next(e)
    const kit = $.ui.resolve(e)
    const { Box } = kit
    return (
      <Box flexDirection="column">
        {MiniPlayer({ Box, Text: kit.Text, Button: kit.Button, ...('Client' in kit ? { Client: kit.Client } : {}) }, player, track, e.props.bodyColumns, {
          command: cmd => void press(cmd),
          // 按钮背后是用户的点击：用这个 hook 的 `$` 打开，引擎认作用户要求的
          openPane: () =>
            void $.ui
              .open({ id: PANE, title: 'cc-music', rows: PANE_ROWS, columns: PANE_COLUMNS, focus: true })
              .then(opened => (opened.isPlaced ? act(afterPaneOpened) : undefined)),
        })}
        {/* 下面的插件画的东西照样画在迷你播放器下面 */}
        {below}
      </Box>
    )
  })
}
