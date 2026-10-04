// 标题旁边跳动的音符（Client）：占两行，三个音符像波浪一样轮流往上跳，
// 落地时 ♪ ♫ 换一下。暂停时都落在下面一行、变淡；加载时慢一点、换成加载的颜色。
import type { ClientModule } from 'claude-code'

import type { PlayerSnapshot } from '../../types'
import { C } from '../theme.ts'
import { instanceOf, startFrames } from './shared.ts'

export type NotesProps = {
  status: PlayerSnapshot['status'] | 'none';
  /** 渐变色带（深到亮） */
  ramp: string[];
}

const MS = 170
const COUNT = 3

type State = { tick: number; props: NotesProps }

const Notes: ClientModule<NotesProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = instanceOf<State>(surface, () => ({ tick: 0, props }))
  state.props = props
  startFrames(surface, MS, state, () => state.props.status === 'playing' || state.props.status === 'loading')

  const isMoving = props.status === 'playing' || props.status === 'loading'
  // 加载时两帧才走一步
  const beat = props.status === 'loading' ? Math.floor(state.tick / 2) : state.tick
  const top: { glyph: string; color: string | undefined }[] = []
  const bottom: { glyph: string; color: string | undefined }[] = []
  for (let i = 0; i < COUNT; i += 1) {
    const isUp = isMoving && (beat + COUNT - i) % COUNT === 0
    const glyph = Math.floor((beat + i) / COUNT) % 2 === 0 ? '♪' : '♫'
    const color = !isMoving
      ? props.status === 'none' ? C.faint : C.dim
      : props.status === 'loading'
        ? C.info
        : isUp ? props.ramp[3] : props.ramp[i % 2 === 0 ? 1 : 2]
    top.push(isUp ? { glyph, color } : { glyph: ' ', color: undefined })
    bottom.push(isUp ? { glyph: ' ', color: undefined } : { glyph, color })
  }
  const row = (cells: typeof top) => (
    <Box flexDirection="row" columnGap={1}>
      {cells.map(cell => (
        <Text color={cell.color} bold>
          {cell.glyph}
        </Text>
      ))}
    </Box>
  )
  return (
    <Box flexDirection="column">
      {row(top)}
      {row(bottom)}
    </Box>
  )
}

export default Notes
