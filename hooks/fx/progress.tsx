// 进度条（Client）：已播部分是从深到亮的橙色渐变，一段流光慢慢扫过；两次轮询之间按帧往前推。
// 下面一行左右是时间，中间是 Claude Code 思考时那样的转圈 + 流光状态字。
// 点进度条就跳到那里；鼠标停在上面时，中间显示会跳到几分几秒。
import type { ClientModule } from 'claude-code'

import type { PlayerSnapshot } from '../../types'
import { formatTime } from '../format.ts'
import { C } from '../theme.ts'
import { clamp01, glimmer, instanceOf, playhead, rampAt, runs, spinnerFrame, startFrames, type Playhead } from './shared.ts'

export type ProgressProps = {
  position: number;
  duration: number | null;
  status: PlayerSnapshot['status'];
  width: number;
  ramp: string[];
}

const MS = 100

/** 中间的状态：播放、加载时转圈，流光扫过状态字 */
const STATUS: Record<PlayerSnapshot['status'], { icon?: string; text: string; color: string; shimmer?: string } | undefined> = {
  playing: { text: '播放中…', color: C.accent, shimmer: C.accentSoft },
  loading: { text: '加载中…', color: C.info, shimmer: C.accentSoft },
  paused: { icon: '▮▮', text: '已暂停', color: C.dim },
  error: { icon: '×', text: '出错了', color: C.error },
  idle: undefined,
}

type State = Playhead & { props: ProgressProps; hoverX?: number }

const Progress: ClientModule<ProgressProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = instanceOf<State>(surface, () => ({ tick: 0, props }))
  state.props = props
  const isFirst = surface.state === undefined
  startFrames(surface, MS, state, () => state.props.status === 'playing' || state.props.status === 'loading')
  if (isFirst) {
    surface.onPointer(event => {
      const { width, duration } = state.props
      const seconds = duration && duration > 0 ? (clamp01(event.x / Math.max(1, width - 1)) * duration) : undefined
      if (event.type === 'down' && seconds !== undefined) surface.post({ action: 'seek', seconds: Math.floor(seconds) })
      const hoverX = event.type === 'leave' || seconds === undefined ? undefined : event.x
      if (hoverX !== state.hoverX) {
        state.hoverX = hoverX
        surface.setState(state.tick)
      }
    })
  }

  const width = Math.max(10, props.width)
  const isPlaying = props.status === 'playing'
  const position = playhead(state, props.position, isPlaying, props.duration, MS)
  const ratio = props.duration && props.duration > 0 ? clamp01(position / props.duration) : 0
  const filled = Math.min(width - 1, Math.round(ratio * (width - 1)))

  // 已播部分：深到亮的渐变，一段亮光两帧走一格地扫过
  const bar: [string, string | undefined][] = []
  for (let i = 0; i < filled; i += 1) {
    const isLit = isPlaying && glimmer(i, filled, Math.floor(state.tick / 2)) <= 1
    bar.push(['━', isLit ? props.ramp[3] : rampAt(props.ramp.slice(0, 3), i / Math.max(1, width - 1))])
  }
  bar.push(['●', isPlaying ? props.ramp[3] : C.dim])
  // 未播部分；鼠标停着的地方画个 ◆，表示点下去会跳到这
  for (let i = filled + 1; i < width; i += 1) bar.push(i === state.hoverX ? ['◆', C.accentSoft] : ['─', C.faint])

  const status = STATUS[props.status]
  const spins = props.status === 'playing' || props.status === 'loading'
  const hoverSeconds = state.hoverX !== undefined && props.duration ? clamp01(state.hoverX / Math.max(1, width - 1)) * props.duration : undefined
  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row">
        {runs(bar).map(run => (
          <Text color={run.color}>{run.text}</Text>
        ))}
      </Box>
      <Box flexDirection="row" justifyContent="space-between" width={width}>
        <Text color={C.dim}>{formatTime(position)}</Text>
        {hoverSeconds !== undefined ? (
          <Text color={C.accentSoft} bold>
            ▸ {formatTime(hoverSeconds)}
          </Text>
        ) : status ? (
          <Box flexDirection="row">
            <Text color={status.color}>{spins ? spinnerFrame(state.tick) : status.icon} </Text>
            {[...status.text].map((char, i) => (
              <Text color={status.shimmer && glimmer(i, status.text.length, state.tick) <= 1 ? status.shimmer : status.color}>{char}</Text>
            ))}
          </Box>
        ) : null}
        <Text color={C.dim}>{formatTime(props.duration)}</Text>
      </Box>
    </Box>
  )
}

export default Progress
