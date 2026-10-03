// 把播放器状态、曲目、搜索结果排成给人看（也给模型看）的文字。
import type { PlayerSnapshot, ProviderInfo, Track } from '../types'

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
  return track.artists.length > 0 ? `${track.title} — ${track.artists.join(' / ')}` : track.title
}

/** 一行文字的进度条，如 `━━━━━━●─────────` */
export function progressBar(position: number, duration: number | null, width: number): string {
  if (width <= 0) return ''
  if (!duration || duration <= 0) return '─'.repeat(width)
  const filled = Math.min(width - 1, Math.max(0, Math.round((position / duration) * (width - 1))))
  return `${'━'.repeat(filled)}●${'─'.repeat(width - 1 - filled)}`
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
/music show | hide     显示/隐藏输入框上方的迷你播放器
/music providers       查看音源
/music quit            关闭后台播放器`
