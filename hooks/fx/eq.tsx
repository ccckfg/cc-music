// 小均衡器图标（Client）：几根竖条上下跳，像音乐 App 里“正在播放”的标记。
// 用在迷你播放器开头、队列里当前那首的序号位置。暂停时停成矮矮的一排。
import type { ClientModule } from 'claude-code'

import type { PlayerSnapshot } from '../../types'
import { C } from '../theme.ts'
import { instanceOf, noise, startFrames } from './shared.ts'

export type EqProps = {
  status: PlayerSnapshot['status'];
  /** 几根竖条 */
  bars: number;
}

const MS = 150
const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇']

type State = { tick: number; props: EqProps }

const Eq: ClientModule<EqProps, number> = (props, surface) => {
  const { Text } = surface.elements
  const state = instanceOf<State>(surface, () => ({ tick: 0, props }))
  state.props = props
  startFrames(surface, MS, state, () => state.props.status === 'playing')

  const isPlaying = props.status === 'playing'
  let bars = ''
  for (let i = 0; i < props.bars; i += 1) {
    // 每根按自己的快慢上下摆，再加一点抖动，看起来不像机械的正弦
    const swing = Math.sin(state.tick * (0.55 + 0.23 * i) + i * 1.7) * 0.5 + 0.5
    const jitter = noise(i + 1, state.tick, 7) * 0.3
    const level = isPlaying ? Math.round(Math.min(1, swing * 0.8 + jitter) * (BLOCKS.length - 1)) : i % 2 === 0 ? 1 : 2
    bars += BLOCKS[level] ?? '▁'
  }
  return <Text color={isPlaying ? C.accent : C.dim}>{bars}</Text>
}

export default Eq
