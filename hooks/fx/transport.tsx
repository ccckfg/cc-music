// 播放控制（Client）：↻ 循环、◀◀、实心橙色胶囊的 ▶ / ▮▮、▶▶、♥ 收藏。
// 循环、收藏开着时是橙色；鼠标移上去会亮，点一下就执行（发消息给 hooks）。
import type { ClientModule } from 'claude-code'

import type { PlayerSnapshot } from '../../types'
import { C, cellWidth } from '../theme.ts'
import { hit, instanceOf, type FxMessage, type Span } from './shared.ts'

export type TransportProps = {
  status: PlayerSnapshot['status'];
  repeat: PlayerSnapshot['repeat'];
  isFavorite: boolean;
  width: number;
  /** 居中，或靠左（输入框上方的横排） */
  align: 'center' | 'start';
}

type Item = Span & { action: FxMessage['action']; text: string; color: string | undefined; isPill?: boolean }
type State = { hovered?: string; redraws: number; items: Item[] }

const Transport: ClientModule<TransportProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const items = layout(props)
  const state = instanceOf<State>(surface, () => ({ redraws: 0, items }))
  state.items = items
  if (surface.state === undefined) {
    surface.setState(0)
    surface.onPointer(event => {
      const item = hit(state.items, event.x)
      if (event.type === 'down' && item) surface.post({ action: item.action } as FxMessage)
      const hovered = event.type === 'leave' ? undefined : item?.action
      if (hovered !== state.hovered) {
        state.hovered = hovered
        state.redraws += 1
        surface.setState(state.redraws)
      }
    })
    surface.onKey(event => {
      if (event.key === ' ' || event.key === 'return') surface.post({ action: 'toggle' })
      if (event.key === 'left') surface.post({ action: 'prev' })
      if (event.key === 'right') surface.post({ action: 'next' })
    })
  }

  let cursor = 0
  return (
    <Box flexDirection="row" width={props.width}>
      {items.flatMap(item => {
        const gap = item.start - cursor
        cursor = item.end
        const isHovered = item.action === state.hovered
        const cell = item.isPill ? (
          <Text color={isHovered ? C.accentSoft : C.accent} inverse bold>
            {item.text}
          </Text>
        ) : (
          <Text color={isHovered ? C.accentSoft : item.color} bold={isHovered ? true : undefined}>
            {item.text}
          </Text>
        )
        return gap > 0 ? [<Text>{' '.repeat(gap)}</Text>, cell] : [cell]
      })}
    </Box>
  )
}

function layout(props: TransportProps): Item[] {
  const isPaused = props.status !== 'playing' && props.status !== 'loading'
  const parts: Omit<Item, 'start' | 'end'>[] = [
    { action: 'repeat', text: props.repeat === 'one' ? '↻¹' : '↻', color: props.repeat === 'off' ? C.faint : C.accent },
    { action: 'prev', text: '◀◀', color: undefined },
    { action: 'toggle', text: isPaused ? ' ▶ ' : ' ▮▮ ', color: undefined, isPill: true },
    { action: 'next', text: '▶▶', color: undefined },
    { action: 'favorite', text: '♥', color: props.isFavorite ? C.accent : C.faint },
  ]
  const total = parts.reduce((sum, part) => sum + cellWidth(part.text), 0)
  const gap = Math.max(2, Math.min(5, Math.floor((props.width - total) / (parts.length + 1))))
  const used = total + gap * (parts.length - 1)
  let x = props.align === 'center' ? Math.max(0, Math.floor((props.width - used) / 2)) : 0
  return parts.map(part => {
    const item = { ...part, start: x, end: x + cellWidth(part.text) }
    x = item.end + gap
    return item
  })
}

export default Transport
