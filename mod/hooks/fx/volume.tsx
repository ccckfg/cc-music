// 音量（Client）：“音量”二字，一排由矮到高的阶梯竖条（到当前音量为止是橙色渐变），右边是数值。
// 点哪根竖条就把音量调到那里，按住拖动也行；鼠标下的那根会亮一点。获得焦点后 ← → 调 10。
import type { ClientModule } from 'claude-code'

import { C } from '../theme.ts'
import { instanceOf, rampAt } from './shared.ts'

export type VolumeProps = {
  volume: number;
  width: number;
  ramp: string[];
}

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
/** “音量 ”和右边“ 100”占的宽度 */
const LABEL = '音量 '
const LABEL_WIDTH = 5
const VALUE_WIDTH = 4

type State = { hovered?: number; isDragging: boolean; redraws: number; props: VolumeProps }

const Volume: ClientModule<VolumeProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = instanceOf<State>(surface, () => ({ isDragging: false, redraws: 0, props }))
  state.props = props
  const bars = barCount(props.width)

  if (surface.state === undefined) {
    surface.setState(0)
    const redraw = () => {
      state.redraws += 1
      surface.setState(state.redraws)
    }
    surface.onPointer(event => {
      const count = barCount(state.props.width)
      const index = event.x - LABEL_WIDTH
      const isOnBars = index >= 0 && index < count
      if (event.type === 'down') state.isDragging = isOnBars
      if (event.type === 'up' || event.type === 'leave') state.isDragging = false
      if ((event.type === 'down' || (event.type === 'move' && state.isDragging)) && isOnBars) {
        surface.post({ action: 'volume', value: levelAt(index, count) })
      }
      const hovered = event.type === 'leave' || !isOnBars ? undefined : index
      if (hovered !== state.hovered) {
        state.hovered = hovered
        redraw()
      }
    })
    surface.onKey(event => {
      const step = event.key === 'right' || event.key === 'up' ? 10 : event.key === 'left' || event.key === 'down' ? -10 : 0
      if (step) surface.post({ action: 'volume', value: Math.max(0, Math.min(100, state.props.volume + step)) })
    })
  }

  const lit = Math.round((props.volume / 100) * bars)
  return (
    <Box flexDirection="row" width={props.width}>
      <Text color={C.dim}>{LABEL}</Text>
      {Array.from({ length: bars }, (_, i) => {
        const block = BLOCKS[Math.min(BLOCKS.length - 1, Math.floor((i * BLOCKS.length) / bars))] ?? '▁'
        const isLit = i < lit
        const color = i === state.hovered ? C.accentSoft : isLit ? rampAt(props.ramp, 0.25 + (0.75 * i) / bars) : C.faint
        return <Text color={color}>{block}</Text>
      })}
      <Text color={C.accent} bold>
        {String(props.volume).padStart(VALUE_WIDTH)}
      </Text>
    </Box>
  )
}

/** 竖条有几根：宽度减去两边的字，最多 16 根 */
function barCount(width: number): number {
  return Math.max(4, Math.min(16, width - LABEL_WIDTH - VALUE_WIDTH))
}

/** 第 index 根竖条对应的音量，取 5 的倍数 */
function levelAt(index: number, count: number): number {
  return Math.round((((index + 1) / count) * 100) / 5) * 5
}

export default Volume
