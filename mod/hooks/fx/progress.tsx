// 进度条（Client）：两次轮询之间按帧往前推，已播部分有一段流光扫过；
// 下面一行左右是时间，中间是 Claude Code 思考时那样的转圈 + 流光状态字。
import type { ClientModule } from 'claude-code'

import type { PlayerSnapshot } from '../../types'
import { formatTime } from '../format.ts'
import { C } from '../theme.ts'
import { clamp01, glimmer, instanceOf, playhead, runs, spinnerFrame, startFrames, type Playhead } from './shared.ts'

export type ProgressProps = {
  position: number;
  duration: number | null;
  status: PlayerSnapshot['status'];
  width: number;
}

const MS = 100

/** 中间的状态：转圈的在播放、加载时动，流光扫过状态字 */
const STATUS: Record<PlayerSnapshot['status'], { icon?: string; text: string; color: string; shimmer?: string } | undefined> = {
  playing: { text: '播放中…', color: C.accent, shimmer: C.accentSoft },
  loading: { text: '加载中…', color: C.info, shimmer: C.accentSoft },
  paused: { icon: '▮▮', text: '已暂停', color: C.dim },
  error: { icon: '×', text: '出错了', color: C.error },
  idle: undefined,
}

type State = Playhead & { props: ProgressProps }

const Progress: ClientModule<ProgressProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = instanceOf<State>(surface, () => ({ tick: 0, props }))
  state.props = props
  startFrames(surface, MS, state, () => state.props.status === 'playing' || state.props.status === 'loading')

  const width = Math.max(10, props.width)
  const isPlaying = props.status === 'playing'
  const position = playhead(state, props.position, isPlaying, props.duration, MS)
  const ratio = props.duration && props.duration > 0 ? clamp01(position / props.duration) : 0
  const filled = Math.min(width - 1, Math.round(ratio * (width - 1)))

  // 已播部分：一段亮光慢慢扫过（两帧走一格）
  const bar: [string, string | undefined][] = []
  for (let i = 0; i < filled; i += 1) {
    const isLit = isPlaying && glimmer(i, filled, Math.floor(state.tick / 2)) <= 1
    bar.push(['━', isLit ? C.accentSoft : C.accent])
  }
  bar.push(['●', isPlaying ? C.accent : C.dim])
  for (let i = filled + 1; i < width; i += 1) bar.push(['─', C.faint])

  const status = STATUS[props.status]
  const spins = props.status === 'playing' || props.status === 'loading'
  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row">
        {runs(bar).map(run => (
          <Text color={run.color}>{run.text}</Text>
        ))}
      </Box>
      <Box flexDirection="row" justifyContent="space-between" width={width}>
        <Text color={C.dim}>{formatTime(position)}</Text>
        {status ? (
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
