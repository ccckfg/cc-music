// 播放器的各个动作：/music 命令和给模型的 music 工具都调用这里。
import type { PlayerCommand, PlayerSnapshot, RepeatMode, Track } from '../types'
import * as daemon from './daemon.ts'
import { describeProviders, describeQueue, describeResults, describeStatus, HELP, parseTime, trackLabel } from './format.ts'
import type { Host } from './host.ts'

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
  await host.setBandHidden(false)
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

const SIMPLE: Record<string, PlayerCommand> = {
  pause: { type: 'pause' }, 暂停: { type: 'pause' },
  resume: { type: 'resume' }, play: { type: 'resume' }, 继续: { type: 'resume' }, 播放: { type: 'resume' },
  toggle: { type: 'toggle' }, p: { type: 'toggle' },
  next: { type: 'next' }, n: { type: 'next' }, skip: { type: 'next' }, 下一首: { type: 'next' },
  prev: { type: 'prev' }, previous: { type: 'prev' }, 上一首: { type: 'prev' },
  stop: { type: 'stop' }, 停止: { type: 'stop' },
  clear: { type: 'clear' }, 清空: { type: 'clear' },
}

/** 执行 `/music` 后面的参数，返回给人看的结果。出错时抛出，消息直接给用户看。 */
export async function runMusic(host: Host, args: string): Promise<string> {
  const text = args.trim()
  const [head = '', ...restParts] = text.split(/\s+/)
  const verb = head.toLowerCase()
  const rest = restParts.join(' ')

  if (text === '' || verb === 'status' || verb === '状态') {
    return describeStatus(await daemon.peekState(host))
  }
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
      await host.setBandHidden(false)
      return '迷你播放器已显示。'
    case 'hide':
      await host.setBandHidden(true)
      return '迷你播放器已隐藏，用 `/music show` 恢复。'
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

  if (/^\d+$/.test(text)) {
    const track = await resultAt(host, Number(text))
    await playNow(host, [track])
    return `▶ 正在加载：${trackLabel(track)}`
  }

  const result = await searchTracks(host, text)
  const top = result.tracks[0]
  if (!top) return describeResults(result.tracks, result.provider)
  await playNow(host, [top])
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
    case 'volume': {
      if (typeof input.volume !== 'number') throw new Error('action=volume 需要 volume（0–100）')
      return runMusic(host, `vol ${Math.round(input.volume)}`)
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
