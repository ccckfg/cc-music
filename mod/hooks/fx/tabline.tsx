// 标签下面那条线（Client）：当前标签下是 Claude 橙的粗线，换标签时滑过去（约 0.2 秒）。
import type { ClientModule } from 'claude-code'

import { C } from '../theme.ts'
import { instanceOf, runs } from './shared.ts'

export type TablineProps = {
  /** 每个标签的 [起始列, 宽度] */
  segments: [number, number][];
  /** 当前标签的序号；-1 表示都不是（比如在设置页） */
  active: number;
  width: number;
}

const MS = 30
const FRAMES = 7

type Span = { x: number; w: number }
/** stop：滑动时才开的帧时钟，滑到了就停 */
type State = { from: Span; to: Span; frame: number; stop?: () => void }

const Tabline: ClientModule<TablineProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const target = targetOf(props)
  const state = instanceOf<State>(surface, () => ({ from: target, to: target, frame: FRAMES }))
  if (surface.state === undefined) surface.setState(0)
  // 换了标签：从现在画到的位置滑向新位置；滑动时才开帧时钟
  if (target.x !== state.to.x || target.w !== state.to.w) {
    state.from = spanAt(state)
    state.to = target
    state.frame = 0
    state.stop ??= surface.every(MS, () => {
      state.frame += 1
      if (state.frame >= FRAMES) {
        state.stop?.()
        state.stop = undefined
      }
      surface.setState(state.frame)
    })
  }

  const span = spanAt(state)
  const start = Math.round(span.x)
  const end = Math.round(span.x + span.w)
  const cells: [string, string][] = []
  for (let i = 0; i < props.width; i += 1) cells.push(i >= start && i < end ? ['━', C.accent] : ['─', C.faint])
  return (
    <Box flexDirection="row" width={props.width}>
      {runs(cells).map(run => (
        <Text color={run.color}>{run.text}</Text>
      ))}
    </Box>
  )
}

function targetOf(props: TablineProps): Span {
  const segment = props.segments[props.active]
  return segment ? { x: segment[0], w: segment[1] } : { x: 0, w: 0 }
}

/** 动画到一半时线的位置：先快后慢 */
function spanAt(state: State): Span {
  const t = Math.min(1, state.frame / FRAMES)
  const ease = 1 - (1 - t) ** 3
  // 从“没有”滑进来时直接出现在目标处
  if (state.from.w === 0) return state.to
  if (state.to.w === 0) return t >= 1 ? state.to : { x: state.from.x, w: state.from.w * (1 - ease) }
  return {
    x: state.from.x + (state.to.x - state.from.x) * ease,
    w: state.from.w + (state.to.w - state.from.w) * ease,
  }
}

export default Tabline
