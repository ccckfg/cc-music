// 把播放器状态、曲目、搜索结果排成给人看（也给模型看）的文字。
import type { LyricLine, LyricsState, PlayerSnapshot, ProviderInfo, Track } from '../types'

const STATUS_TEXT: Record<PlayerSnapshot['status'], string> = {
  idle: '已停止',
  loading: '加载中',
  playing: '播放中',
  paused: '已暂停',
  error: '出错',
}

const REPEAT_TEXT: Record<PlayerSnapshot['repeat'], string> = {
  off: '不循环',
  all: '列表循环',
  one: '单曲循环',
}

/** 秒 → `3:05`、`1:02:03` */
export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--'
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** `3:05` / `1:02:03` / `90` / `+10` / `-10` → 秒数和是否相对 */
export function parseTime(text: string): { seconds: number; relative: boolean } | undefined {
  const match = /^([+-])?(\d+(?::\d{1,2}){0,2})$/.exec(text.trim())
  if (!match?.[2]) return undefined
  const seconds = match[2].split(':').map(Number).reduce((total, part) => total * 60 + part, 0)
  if (match[1] === undefined) return { seconds, relative: false }
  return { seconds: match[1] === '-' ? -seconds : seconds, relative: true }
}

export function trackLabel(track: Track): string {
  const title = decodeEntities(track.title)
  return track.artists.length > 0 ? `${title} — ${track.artists.join(' / ')}` : title
}

const NAMED_ENTITIES: Record<string, string> = { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&', nbsp: ' ' }

/** 解 HTML 实体；B 站的标题有时转义两遍（`&amp;#x27;`），旧版 daemon 存下的收藏、历史里还有 */
export function decodeEntities(text: string): string {
  let out = text
  for (let pass = 0; pass < 3; pass += 1) {
    const decoded = out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
      if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? entity
      const isHex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
    })
    if (decoded === out) break
    out = decoded
  }
  return out
}

/** 面板里显示的标题：title 是歌名，detail 是标题里剩下的修饰（歌手、“超清现场”、【标签】），没有时为空 */
export type TitleParts = { title: string; detail: string }

/** (Official Video)、(Lyric Video)、（官方MV）这类视频后缀 */
const VIDEO_SUFFIX = /\s*[(（]\s*(?:official|lyrics?|audio|video|music video|mv|visuali[sz]er|hd|4k|官方|中字|中英)[^)）]*[)）]/gi

/**
 * 拆标题。B 站的标题常是“歌手《歌名》修饰词”“日推|《歌名》- 歌手”或带【标签】：
 * 有《书名号》就取它当歌名，其余的放进 detail；没有就去掉视频后缀、理顺分隔符。YouTube Music 的标题本来就干净。
 */
export function titleParts(track: Track): TitleParts {
  const raw = decodeEntities(track.title).replace(/\s+/g, ' ').trim()
  if (track.provider !== 'bilibili') return { title: raw, detail: '' }
  const tags = [...raw.matchAll(/【([^】]*)】/g)].map(match => (match[1] ?? '').trim()).filter(Boolean)
  const rest = raw.replace(/【[^】]*】/g, ' ')
  const book = /《([^》]+)》/.exec(rest)
  const title = book?.[1]?.trim()
  if (book && title) {
    const detail = tidy(rest.replace(book[0], ' | '))
    return { title, detail: [detail, ...tags].filter(Boolean).join(' · ') }
  }
  return { title: tidy(rest.replace(VIDEO_SUFFIX, ' ')) || raw, detail: tags.join(' · ') }
}

/** 把 | ｜ 和两边带空格的 - — / 换成 ·，去掉首尾和重复的分隔符 */
function tidy(text: string): string {
  return text
    .replace(/\s*[|｜]\s*/g, ' · ')
    .replace(/\s+[-—–/／]+\s+/g, ' · ')
    .replace(/\s+/g, ' ')
    .replace(/(?:\s*·\s*){2,}/g, ' · ')
    .replace(/^\s*·\s*|\s*·\s*$/g, '')
    .trim()
}

export function describeStatus(player: PlayerSnapshot | null): string {
  if (!player) return '播放器没有在运行。用 `/music <歌名>` 开始听歌。'
  const lines: string[] = []
  if (player.current) {
    const album = player.current.album ? ` 《${player.current.album}》` : ''
    lines.push(`${STATUS_TEXT[player.status]}：${trackLabel(player.current)}${album}`)
    lines.push(`进度 ${formatTime(player.position)} / ${formatTime(player.duration)} · 音量 ${player.volume} · ${REPEAT_TEXT[player.repeat]} · 来源 ${player.current.provider}`)
  } else {
    lines.push(`${STATUS_TEXT[player.status]}，队列为空。`)
  }
  if (player.error) lines.push(`错误：${player.error}`)
  if (player.queue.length > 1) lines.push(`队列共 ${player.queue.length} 首，当前第 ${player.index + 1} 首（/music queue 查看）`)
  return lines.join('\n')
}

export function describeQueue(player: PlayerSnapshot | null): string {
  if (!player || player.queue.length === 0) return '队列为空。'
  const lines = player.queue.map((track, i) => {
    const marker = i === player.index ? '▶' : ' '
    return `${marker} ${String(i + 1).padStart(2)}. ${trackLabel(track)}  ${formatTime(track.durationSec)}`
  })
  return [`播放队列（${REPEAT_TEXT[player.repeat]}）：`, ...lines].join('\n')
}

export function describeResults(tracks: Track[], provider: string): string {
  if (tracks.length === 0) return `在 ${provider} 没有搜到结果。`
  const lines = tracks.map((track, i) => `${String(i + 1).padStart(2)}. ${trackLabel(track)}  ${formatTime(track.durationSec)}`)
  return [`${provider} 的搜索结果：`, ...lines].join('\n')
}

export function describeProviders(providers: ProviderInfo[]): string {
  return providers
    .map(p => `- ${p.id}（前缀 ${[p.id, ...p.aliases].map(a => `${a}:`).join(' ')}）${p.isDefault ? ' · 默认' : ''}${p.note ? ` · ${p.note}` : ''}`)
    .join('\n')
}

export const HELP = `用法：
/music                 打开 cc-music 面板（正在播放、歌词、搜索、队列、收藏、历史；右上角是设置）
/music <歌名>          搜索并立即播放第一个结果（插在当前歌曲之后）
/music bili:<歌名>     指定音源搜索（bili: 哔哩哔哩，yt: YouTube Music）
/music <序号>          播放上次搜索结果里的第几首
/music add <歌名|序号>  加到队列末尾
/music search <歌名>   只搜索，不播放
/music pause | resume | toggle | next | prev | stop
/music vol <0-100|+10|-10>   音量
/music seek <1:30|+10|-10>   跳转
/music repeat <off|all|one>  循环模式
/music queue           查看队列
/music jump <序号>     跳到队列里的第几首
/music clear           清空队列
/music lyrics          显示当前歌曲的歌词
/music fav             收藏/取消收藏当前歌曲
/music favs | history  查看收藏 / 播放历史
/music show | hide     显示/隐藏输入框上方的迷你播放器
/music providers       查看音源
/music status          当前播放状态
/music restart         重启后台播放器（保留队列和进度）
/music quit            关闭后台播放器`

export function trackKey(track: Track): string {
  return `${track.provider}:${track.id}`
}

/** 当前该唱到哪一行：最后一行开始时间不晚于 position 的；还没开始唱时为 -1。 */
export function currentLyricIndex(lines: LyricLine[], position: number): number {
  let low = 0
  let high = lines.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if ((lines[mid]?.time ?? Infinity) <= position + 0.2) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

export function describeLyrics(lyrics: LyricsState | null, track: Track | null): string {
  if (!track) return '现在没有在播放。'
  if (!lyrics || lyrics.key !== trackKey(track)) return `正在查找${quoteTitle(track.title)}的歌词…`
  if (lyrics.error) return `查找歌词失败：${lyrics.error}`
  const text = lyrics.synced ? lyrics.synced.map(line => line.text).join('\n') : lyrics.plain
  if (!text) return `没有找到${quoteTitle(track.title)}的歌词。`
  return `${quoteTitle(track.title)}的歌词（来源 ${lyrics.source}）：\n\n${text}`
}

export function describeTrackList(title: string, tracks: Track[], empty: string): string {
  if (tracks.length === 0) return empty
  const lines = tracks.map((track, i) => `${String(i + 1).padStart(2)}. ${trackLabel(track)}  ${formatTime(track.durationSec)}`)
  return [title, ...lines].join('\n')
}

/** ISO 时间 → “3 分钟前”“昨天 21:05”这类相对说法 */
export function timeAgo(iso: string, now = Date.now()): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const minutes = Math.floor((now - then) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return days === 1 ? '昨天' : `${days} 天前`
}

/** 给歌名加书名号；标题里已经有《》（B 站常见）时不再加。 */
export function quoteTitle(title: string): string {
  return title.includes('《') ? title : `《${title}》`
}
