// cc-music mod 入口：注册 /music 命令和给模型的 music 工具，轮询 daemon，画输入框上方的迷你播放器。
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { PlayerCommand, PlayerSnapshot } from '../types'
import * as daemon from './daemon.ts'
import { formatTime, progressBar, trackLabel } from './format.ts'
import { errorText, type Host } from './host.ts'
import { runMusic, runTool, send, type ToolInput } from './music.ts'

// $.state 里的值：热重载后仍在，迷你播放器从这里读。引擎要求它们在使用它们的文件里声明
const playerAtom = atom({ plugin: 'cc-music', key: 'player' } as const, null)
const lastSearchAtom = atom({ plugin: 'cc-music', key: 'lastSearch' } as const, null)
const bandHiddenAtom = atom({ plugin: 'cc-music', key: 'isBandHidden' } as const, false)

const COMMAND = 'music'
const TOOL = 'music'
const TOOL_NAME = 'mcp__cc-music__music'

/** 播放中每秒取一次状态；空闲时每 IDLE_EVERY 秒一次 */
const POLL_MS = 1000
const IDLE_EVERY = 5

const STATUS_WORD: Partial<Record<PlayerSnapshot['status'], { text: string; color: string }>> = {
  loading: { text: '加载中', color: 'cyan' },
  paused: { text: '已暂停', color: 'yellow' },
  error: { text: '出错', color: 'red' },
}

const TOOL_DESCRIPTION = `控制用户在 Claude Code 里的背景音乐播放器（cc-music）。用户想听歌、点歌、切歌、暂停、调音量，或问正在放什么时使用。
- action=play：按 query 搜索并立即播放最匹配的一首；原有队列保留，新歌插在当前歌曲之后
- action=queue：按 query 搜索，把最匹配的一首加到队列末尾。要排好几首歌就多次调用，每次 query 写一首具体的歌
- action=search：只搜索，返回候选列表，不播放
- action=pause / resume / next / prev / stop：播放控制
- action=volume：把音量设为 volume（0–100）
- action=status：当前在放什么、队列里有什么
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
    announce(host, player)
  } catch (error) {
    host.debug(`轮询失败：${errorText(error)}`)
  } finally {
    isPolling = false
  }
}

/** 迷你播放器上的按钮：发命令，失败时用 toast 告诉用户。 */
async function press(cmd: PlayerCommand): Promise<void> {
  const current = host
  if (!current) return
  try {
    await send(current, cmd)
  } catch (error) {
    current.toast(`cc-music：${errorText(error)}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const root = $.plugin.root
    host = {
      fetch: (url, init) => $.http.fetch(url, init),
      readText: path => $.fs.read(path),
      run: (argv, timeoutMs) => $.process.run(argv, { timeoutMs }),
      dataDir: async () => {
        const custom = await $.env.get('CC_MUSIC_HOME')
        if (custom) return custom
        const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
        return `${home}/.cc-music`
      },
      launcher: async () => {
        // 插件目录可能是指向仓库的链接，先解析真实路径；daemon 在仓库的 daemon/ 下
        const stat = await $.fs.stat(root, { resolve: true }).catch(() => undefined)
        const repo = (stat?.realPath ?? root).replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '')
        return {
          node: (await $.env.get('CC_MUSIC_NODE')) ?? 'node',
          script: (await $.env.get('CC_MUSIC_DAEMON')) ?? `${repo}/daemon/src/launch.ts`,
        }
      },
      getPlayer: () => read($, playerAtom),
      setPlayer: player => update($, playerAtom, () => player).then(() => undefined),
      getLastSearch: () => read($, lastSearchAtom),
      setLastSearch: search => update($, lastSearchAtom, () => search).then(() => undefined),
      setBandHidden: isHidden => update($, bandHiddenAtom, () => isHidden).then(() => undefined),
      toast: (text, timeoutMs) => $.ui.toast(text, timeoutMs === undefined ? undefined : { timeoutMs }),
      debug: text => $.ui.log(`cc-music: ${text}`, { to: 'debug' }),
    }

    await $.command.register({
      name: COMMAND,
      description: '听音乐：/music <歌名> 搜索播放，/music help 查看全部用法',
      argumentHint: '[歌名 | 序号 | pause | next | vol 60 | queue | help]',
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
            enum: ['play', 'queue', 'search', 'pause', 'resume', 'next', 'prev', 'stop', 'volume', 'status'],
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

  on('command.run', { command: COMMAND }, async (_$, e) => {
    try {
      return { text: await runMusic(requireHost(), e.args) }
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const player = await read($, playerAtom)
    const isHidden = await read($, bandHiddenAtom)
    const track = player?.current
    if (isHidden || !player || !track || player.status === 'idle') return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const word = STATUS_WORD[player.status]
    const hasSideButtons = columns >= 60
    const barWidth = Math.min(30, columns - 80)
    const time =
      barWidth >= 8
        ? `${formatTime(player.position)} ${progressBar(player.position, player.duration, barWidth)} ${formatTime(player.duration)}`
        : `${formatTime(player.position)}/${formatTime(player.duration)}`

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Box flexGrow={1} flexShrink={1} minWidth={8}>
            <Text color="magenta">♪ </Text>
            <Text wrap="truncate-end">{trackLabel(track)}</Text>
          </Box>
          <Box flexShrink={0} marginLeft={1} gap={1}>
            {word ? <Text color={word.color}>{word.text}</Text> : null}
            <Text dimColor>{time}</Text>
            {hasSideButtons ? <Button key="prev" label="上一首" hotkey="b" onPress={() => void press({ type: 'prev' })} /> : null}
            <Button
              key="toggle"
              label={player.status === 'paused' ? '播放' : '暂停'}
              hotkey="p"
              onPress={() => void press({ type: 'toggle' })}
            />
            {hasSideButtons ? <Button key="next" label="下一首" hotkey="n" onPress={() => void press({ type: 'next' })} /> : null}
          </Box>
        </Box>
        {player.status === 'error' && player.error ? (
          <Text color="red" wrap="truncate-end">
            {player.error}
          </Text>
        ) : null}
      </Box>
    )
  })
}
