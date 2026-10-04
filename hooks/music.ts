// 播放器的各个动作：/music 命令和给模型的 music 工具都调用这里。
import type { ConfigPatch, LibraryResponse, LyricsState, PlayerCommand, PlayerSnapshot, Prefs, RepeatMode, Track } from '../types'
import * as daemon from './daemon.ts'
import {
  describeLyrics,
  describeProviders,
  describeQueue,
  describeResults,
  describeStatus,
  describeTrackList,
  HELP,
  parseTime,
  quoteTitle,
  timeAgo,
  trackKey,
  trackLabel,
} from './format.ts'
import { errorText, type Host } from './host.ts'

const SEARCH_LIMIT = 10

/** 发命令给 daemon，并立刻把返回的状态写进 $.state，迷你播放器不用等下一次轮询。 */
export async function send(host: Host, cmd: PlayerCommand): Promise<PlayerSnapshot> {
  const player = await daemon.command(host, cmd)
  await host.setPlayer(player)
  return player
}

/** `bili:晴天` → 音源 bilibili + 关键词；前缀不是已知音源时整串都是关键词。 */
async function splitProvider(host: Host, text: string): Promise<{ query: string; provider?: string }> {
  const match = /^([A-Za-z]+)[:：]\s*(.+)$/.exec(text)
  if (!match?.[1] || !match[2]) return { query: text }
  const prefix = match[1].toLowerCase()
  const providers = await daemon.listProviders(host)
  const provider = providers.find(p => p.id === prefix || p.aliases.includes(prefix))
  return provider ? { query: match[2], provider: provider.id } : { query: text }
}

/** 搜索并记住结果，供 `/music <序号>` 使用。 */
export async function searchTracks(host: Host, text: string, limit = SEARCH_LIMIT): Promise<{ provider: string; tracks: Track[] }> {
  const { query, provider } = await splitProvider(host, text)
  const result = await daemon.search(host, query, provider, limit)
  await host.setLastSearch({ query, provider: result.provider, tracks: result.tracks })
  return result
}

/** 立即播放：插到当前曲目之后并切过去，原来的队列保留。 */
export async function playNow(host: Host, tracks: Track[]): Promise<PlayerSnapshot> {
  return send(host, { type: 'enqueue', tracks, next: true, play: true })
}

export async function enqueue(host: Host, tracks: Track[]): Promise<PlayerSnapshot> {
  return send(host, { type: 'enqueue', tracks })
}

async function resultAt(host: Host, position: number): Promise<Track> {
  const last = await host.getLastSearch()
  const track = last?.tracks[position - 1]
  if (!last) throw new Error('还没有搜索过。先用 `/music <歌名>` 或 `/music search <歌名>` 搜索。')
  if (!track) throw new Error(`上次搜索只有 ${last.tracks.length} 个结果。`)
  return track
}

export async function refreshLibrary(host: Host): Promise<LibraryResponse> {
  const library = await daemon.library(host)
  await host.setLibrary(library)
  return library
}

/** 收藏或取消收藏（缺省是当前曲目），返回给人看的结果。 */
export async function toggleFavorite(host: Host, track?: Track): Promise<string> {
  const target = track ?? (await daemon.peekState(host))?.current
  if (!target) throw new Error('现在没有在播放，不知道收藏哪首。')
  const known = (await host.getLibrary()) ?? (await refreshLibrary(host))
  const isFavorite = known.favorites.some(t => trackKey(t) === trackKey(target))
  await host.setLibrary(await daemon.setFavorite(host, target, !isFavorite))
  return `${isFavorite ? '已取消收藏' : '♥ 已收藏'}：${trackLabel(target)}`
}

/** 正在取的歌词，按曲目合并重复请求 */
let lyricsLoading: { key: string; promise: Promise<LyricsState> } | undefined
let coverKey: string | undefined

/** 取曲目的歌词并写进 $.state；已经有了直接返回，正在取就等同一个请求。 */
export async function loadLyrics(host: Host, track: Track): Promise<LyricsState> {
  const key = trackKey(track)
  const known = await host.getLyrics()
  if (known?.key === key) return known
  if (lyricsLoading?.key === key) return lyricsLoading.promise

  const promise = daemon
    .lyrics(host, track)
    .catch((error): LyricsState => ({ key, synced: null, plain: null, source: null, error: errorText(error) }))
    .then(async lyrics => {
      await host.setLyrics(lyrics)
      return lyrics
    })
    .finally(() => {
      if (lyricsLoading?.key === key) lyricsLoading = undefined
    })
  lyricsLoading = { key, promise }
  return promise
}

/**
 * 当前曲目变了时取歌词、刷新播放历史；面板开着且没关掉封面时再取封面。轮询每秒调用。
 * 旧版 daemon 没有这些接口，跳过。
 */
export async function syncTrackExtras(host: Host, player: PlayerSnapshot | null): Promise<void> {
  const track = player?.current
  if (!track) return
  const key = trackKey(track)
  if ((await daemon.runningVersion(host)) !== daemon.DAEMON_VERSION) return

  if (lyricsLoading?.key !== key && (await host.getLyrics())?.key !== key) {
    // 换歌了：播放历史也变了
    refreshLibrary(host).catch(() => undefined)
    void loadLyrics(host, track)
  }

  const wantsCover = (await host.isPaneOpen()) && (await host.getPrefs()).showCover
  if (coverKey !== key && wantsCover && (await host.getCover())?.key !== key) {
    coverKey = key
    daemon
      .cover(host, track)
      .then(cover => host.setCover(cover))
      .catch(error => host.debug(`封面失败：${errorText(error)}`))
      .finally(() => {
        if (coverKey === key) coverKey = undefined
      })
  }
}

/** 换新版 daemon：记下队列和进度，关掉旧的，拉起新的，再接着放。 */
export async function restart(host: Host): Promise<string> {
  const before = await daemon.peekState(host)
  await daemon.shutdown(host)
  await host.setPlayer(null)
  if (!before || before.queue.length === 0) {
    await daemon.connect(host, { launch: true })
    return '后台播放器已重启。'
  }
  await send(host, { type: 'volume', value: before.volume })
  await send(host, { type: 'repeat', mode: before.repeat })
  const wasPlaying = before.status === 'playing' || before.status === 'loading' || before.status === 'paused'
  if (!wasPlaying) {
    await send(host, { type: 'enqueue', tracks: before.queue })
    await send(host, { type: 'stop' })
    return '后台播放器已重启，队列已恢复。'
  }
  await send(host, { type: 'play', tracks: before.queue, start: Math.max(0, before.index) })
  // 等新曲目加载出来再跳回原来的位置
  for (let i = 0; i < 40 && before.position > 3; i += 1) {
    const now = await daemon.peekState(host)
    if (now?.status === 'playing') {
      await send(host, { type: 'seek', seconds: before.position })
      break
    }
    if (now?.status === 'error') break
    await host.sleep(250)
  }
  if (before.status === 'paused') await send(host, { type: 'pause' })
  return before.current ? `后台播放器已重启，接着放${quoteTitle(before.current.title)}。` : '后台播放器已重启。'
}

function parseIndex(text: string | undefined, what: string): number {
  const n = Number(text)
  if (!text || !Number.isInteger(n) || n < 1) throw new Error(`${what}需要一个从 1 开始的序号。`)
  return n
}

function parseVolume(text: string | undefined): PlayerCommand {
  const match = /^([+-])?(\d{1,3})$/.exec(text?.trim() ?? '')
  if (!match?.[2]) throw new Error('音量写成 0–100 的数字，或 +10 / -10。')
  const n = Number(match[2])
  if (match[1] === undefined) return { type: 'volume', value: n }
  return { type: 'volume', delta: match[1] === '-' ? -n : n }
}

const REPEAT_MODES: Record<string, RepeatMode> = {
  off: 'off', 关: 'off', 不循环: 'off',
  all: 'all', list: 'all', 列表: 'all', 列表循环: 'all',
  one: 'one', single: 'one', 单曲: 'one', 单曲循环: 'one',
}

/** 英文命令词：/music 后面只有一个词、又和其中一个只差一个字母时，多半是打错了 */
const COMMAND_WORDS = [
  'pause', 'resume', 'toggle', 'next', 'skip', 'prev', 'previous', 'stop', 'clear',
  'volume', 'seek', 'repeat', 'queue', 'jump', 'remove', 'show', 'hide', 'lyrics',
  'favs', 'favorites', 'history', 'restart', 'providers', 'quit', 'exit', 'search',
  'status', 'help', 'panel',
]

/** 打错的命令（/music resyart → restart）；不像打错时返回 undefined，照常拿去搜歌 */
function typoOf(word: string): string | undefined {
  if (!/^[a-z]{4,}$/.test(word) || COMMAND_WORDS.includes(word)) return undefined
  return COMMAND_WORDS.find(command => Math.abs(command.length - word.length) <= 1 && editDistance(word, command) <= 1)
}

/** 编辑距离，相邻两个字母对调也算一步（resatrt → restart） */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const row = d[i] as number[]
      const above = d[i - 1] as number[]
      row[j] = Math.min((above[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (above[j - 1] ?? 0) + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j] ?? 0, ((d[i - 2] as number[])[j - 2] ?? 0) + 1)
    }
  }
  return (d[a.length] as number[])[b.length] ?? 0
}

const SIMPLE: Record<string, PlayerCommand> = {
  pause: { type: 'pause' }, 暂停: { type: 'pause' },
  resume: { type: 'resume' }, play: { type: 'resume' }, 继续: { type: 'resume' }, 播放: { type: 'resume' },
  toggle: { type: 'toggle' }, p: { type: 'toggle' },
  next: { type: 'next' }, n: { type: 'next' }, skip: { type: 'next' }, 下一首: { type: 'next' },
  prev: { type: 'prev' }, previous: { type: 'prev' }, 上一首: { type: 'prev' },
  stop: { type: 'stop' }, 停止: { type: 'stop' },
  clear: { type: 'clear' }, 清空: { type: 'clear' },
}

const PANE_VERBS = new Set(['', 'panel', 'ui', '面板'])

/**
 * `/music` 的结果。`pane` 告诉命令 hook 要不要打开面板：`open` 总是打开（`/music`、`/music panel`），
 * `sidebar` 只在能停靠成侧边栏时打开（开始放一首歌）。面板要由命令 hook 用自己的 `$` 打开，
 * 引擎才认作“用户要求的”，所以这里只给出意图。
 */
export type MusicReply = { text: string; pane?: 'open' | 'sidebar' }

/** 面板摆上屏幕之后：记下它开着，取封面和收藏。 */
export async function afterPaneOpened(host: Host): Promise<void> {
  await host.setPaneOpen(true)
  await syncTrackExtras(host, await host.getPlayer())
  await refreshLibrary(host).catch(() => undefined)
}

/** 执行 `/music` 后面的参数，返回给人看的结果和面板意图。出错时抛出，消息直接给用户看。 */
export async function runMusic(host: Host, args: string): Promise<MusicReply> {
  let isPlayNow = false
  const text = await runMusicText(host, args, () => {
    isPlayNow = true
  })
  const verb = (args.trim().split(/\s+/)[0] ?? '').toLowerCase()
  if (PANE_VERBS.has(verb)) return { text, pane: 'open' }
  return isPlayNow && (await host.getPrefs()).autoOpenSidebar ? { text, pane: 'sidebar' } : { text }
}

async function runMusicText(host: Host, args: string, onPlayNow: () => void): Promise<string> {
  const text = args.trim()
  const [head = '', ...restParts] = text.split(/\s+/)
  const verb = head.toLowerCase()
  const rest = restParts.join(' ')

  if (PANE_VERBS.has(verb) || verb === 'status' || verb === '状态') return describeStatus(await daemon.peekState(host))
  if (verb === 'help' || verb === '帮助' || verb === '?') return HELP

  const simple = SIMPLE[verb]
  if (simple && rest === '') {
    const player = await send(host, simple)
    return describeStatus(player)
  }

  switch (verb) {
    case 'vol':
    case 'volume':
    case '音量': {
      const player = await send(host, parseVolume(rest))
      return `音量 ${player.volume}`
    }
    case 'seek':
    case '跳转': {
      const time = parseTime(rest)
      if (!time) throw new Error('跳转写成 1:30、90、+10 或 -10。')
      const player = await send(host, { type: 'seek', seconds: time.seconds, relative: time.relative })
      return describeStatus(player)
    }
    case 'repeat':
    case '循环': {
      const mode = REPEAT_MODES[rest.toLowerCase()]
      if (!mode) throw new Error('循环模式：off（不循环）、all（列表循环）、one（单曲循环）。')
      return describeStatus(await send(host, { type: 'repeat', mode }))
    }
    case 'queue':
    case 'q':
    case '队列':
      return describeQueue(await daemon.peekState(host))
    case 'jump':
      return describeStatus(await send(host, { type: 'jump', index: parseIndex(rest, '跳转') - 1 }))
    case 'remove':
    case 'rm':
      return describeQueue(await send(host, { type: 'remove', index: parseIndex(rest, '移除') - 1 }))
    case 'show':
      await host.setPrefs({ showMiniPlayer: true })
      return '迷你播放器已显示。'
    case 'hide':
      await host.setPrefs({ showMiniPlayer: false })
      return '迷你播放器已隐藏，用 `/music show` 或面板的设置页恢复。'
    case 'lyrics':
    case 'lrc':
    case '歌词': {
      const track = (await daemon.peekState(host))?.current ?? null
      if (track && (await daemon.runningVersion(host)) !== daemon.DAEMON_VERSION) {
        throw new Error('后台播放器是旧版本，不支持歌词。先运行 /music restart。')
      }
      return describeLyrics(track ? await loadLyrics(host, track) : null, track)
    }
    case 'fav':
    case 'like':
    case '收藏':
      return toggleFavorite(host)
    case 'favs':
    case 'favorites':
    case '收藏夹': {
      const { favorites } = await refreshLibrary(host)
      return describeTrackList(`收藏（${favorites.length} 首）：`, favorites, '还没有收藏。播放时用 `/music fav` 收藏当前歌曲。')
    }
    case 'history':
    case '历史': {
      const { history } = await refreshLibrary(host)
      if (history.length === 0) return '还没有播放历史。'
      const lines = history.slice(0, 30).map((entry, i) => `${String(i + 1).padStart(2)}. ${trackLabel(entry.track)}  ${timeAgo(entry.playedAt)}`)
      return ['最近播放：', ...lines].join('\n')
    }
    case 'restart':
    case '重启':
      return restart(host)
    case 'providers':
    case '音源':
      return describeProviders(await daemon.listProviders(host))
    case 'quit':
    case 'exit':
    case '退出': {
      const wasRunning = await daemon.shutdown(host)
      await host.setPlayer(null)
      return wasRunning ? '后台播放器已关闭。' : '后台播放器本来就没有在运行。'
    }
    case 'search':
    case '搜索': {
      if (!rest) throw new Error('要搜什么？例如 `/music search 晴天`。')
      const result = await searchTracks(host, rest)
      return `${describeResults(result.tracks, result.provider)}\n\n用 /music <序号> 播放，/music add <序号> 加入队列。`
    }
    case 'add':
    case '添加': {
      if (!rest) throw new Error('要加什么？例如 `/music add 晴天` 或 `/music add 3`。')
      if (/^\d+$/.test(rest)) {
        const track = await resultAt(host, Number(rest))
        const player = await enqueue(host, [track])
        return `已加入队列（第 ${player.queue.length} 首）：${trackLabel(track)}`
      }
      if (rest === 'all' || rest === '全部') {
        const last = await host.getLastSearch()
        if (!last || last.tracks.length === 0) throw new Error('还没有搜索结果可以加入。')
        const player = await enqueue(host, last.tracks)
        return `已把 ${last.tracks.length} 首加入队列，队列共 ${player.queue.length} 首。`
      }
      const result = await searchTracks(host, rest)
      const top = result.tracks[0]
      if (!top) return describeResults(result.tracks, result.provider)
      const player = await enqueue(host, [top])
      return `已加入队列（第 ${player.queue.length} 首）：${trackLabel(top)}`
    }
  }

  const typo = typoOf(text.toLowerCase())
  if (typo) throw new Error(`没有 “${text}” 这个命令，是想输入 /music ${typo} 吗？要搜这首歌请用 /music search ${text}。`)

  if (/^\d+$/.test(text)) {
    const track = await resultAt(host, Number(text))
    await playNow(host, [track])
    onPlayNow()
    return `▶ 正在加载：${trackLabel(track)}`
  }

  const result = await searchTracks(host, text)
  const top = result.tracks[0]
  if (!top) return describeResults(result.tracks, result.provider)
  await playNow(host, [top])
  onPlayNow()
  return [
    `▶ 正在加载：${trackLabel(top)}`,
    '',
    describeResults(result.tracks, result.provider),
    '',
    '不是想要的？用 /music <序号> 换一首，/music add <序号> 加入队列。',
  ].join('\n')
}

/** 给模型的 music 工具的输入，见 register.tsx 里的 inputSchema。 */
export type ToolInput = {
  action?: string;
  query?: string;
  provider?: string;
  volume?: number;
}

const TOOL_CONTROLS: Record<string, PlayerCommand> = {
  pause: { type: 'pause' },
  resume: { type: 'resume' },
  next: { type: 'next' },
  prev: { type: 'prev' },
  stop: { type: 'stop' },
}

/** 执行模型的一次 music 工具调用，返回给模型读的文字。 */
export async function runTool(host: Host, input: ToolInput): Promise<string> {
  const action = input.action ?? 'status'
  const control = TOOL_CONTROLS[action]
  if (control) return describeStatus(await send(host, control))

  switch (action) {
    case 'status': {
      const player = await daemon.peekState(host)
      return player && player.queue.length > 1 ? `${describeStatus(player)}\n\n${describeQueue(player)}` : describeStatus(player)
    }
    case 'lyrics':
      return runMusicText(host, 'lyrics', () => undefined)
    case 'favorite':
      return toggleFavorite(host)
    case 'volume': {
      if (typeof input.volume !== 'number') throw new Error('action=volume 需要 volume（0–100）')
      return runMusicText(host, `vol ${Math.round(input.volume)}`, () => undefined)
    }
    case 'play':
    case 'queue':
    case 'search': {
      const query = input.query?.trim()
      if (!query) throw new Error(`action=${action} 需要 query`)
      const result = await searchTracks(host, input.provider ? `${input.provider}:${query}` : query)
      const top = result.tracks[0]
      if (action === 'search' || !top) return describeResults(result.tracks, result.provider)
      if (action === 'play') {
        await playNow(host, [top])
        return `已开始播放：${trackLabel(top)}（${result.provider}）`
      }
      const player = await enqueue(host, [top])
      return `已加入队列第 ${player.queue.length} 首：${trackLabel(top)}（${result.provider}）`
    }
    default:
      throw new Error(`不认识的 action：${action}`)
  }
}

/** 偏好的默认值：都开着 */
export const DEFAULT_PREFS: Prefs = { showMiniPlayer: true, autoOpenSidebar: true, showCover: true }

/** 从 $.store 读回来的偏好：只认识的、类型对的项，其余用默认值。 */
export function parsePrefs(value: unknown): Prefs {
  const prefs = { ...DEFAULT_PREFS }
  if (typeof value !== 'object' || value === null) return prefs
  for (const key of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
    const stored = (value as Record<string, unknown>)[key]
    if (typeof stored === 'boolean') prefs[key] = stored
  }
  return prefs
}

/** 打开设置页：从 daemon 读配置（没在运行就拉起来）。 */
export async function loadSettings(host: Host): Promise<void> {
  try {
    await host.setSettings({ config: await daemon.getConfig(host), error: null })
  } catch (error) {
    await host.setSettings({ config: null, error: errorText(error) })
  }
}

/** 设置页改 daemon 的配置；失败时保留原来的值，把原因显示在设置页上。 */
export async function changeSettings(host: Host, patch: ConfigPatch): Promise<void> {
  try {
    await host.setSettings({ config: await daemon.setConfig(host, patch), error: null })
  } catch (error) {
    const previous = await host.getSettings()
    await host.setSettings({ config: previous?.config ?? null, error: errorText(error) })
  }
}
