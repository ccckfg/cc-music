// 胶囊按钮（Client）：实心橙底的一段文字，鼠标移上去变亮，点一下发 { action } 给 hooks。
import type { ClientModule } from 'claude-code'

import { C } from '../theme.ts'
import { instanceOf, type FxMessage } from './shared.ts'

export type PillProps = {
  label: string;
  action: FxMessage['action'];
}

type State = { props: PillProps; isHovered: boolean; redraws: number }

const Pill: ClientModule<PillProps, number> = (props, surface) => {
  const { Text } = surface.elements
  const state = instanceOf<State>(surface, () => ({ props, isHovered: false, redraws: 0 }))
  state.props = props
  if (surface.state === undefined) {
    surface.setState(0)
    surface.onPointer(event => {
      if (event.type === 'down') surface.post({ action: state.props.action } as FxMessage)
      const isHovered = event.type !== 'leave'
      if (isHovered !== state.isHovered) {
        state.isHovered = isHovered
        state.redraws += 1
        surface.setState(state.redraws)
      }
    })
    surface.onKey(event => {
      if (event.key === ' ' || event.key === 'return') surface.post({ action: state.props.action } as FxMessage)
    })
  }
  return (
    <Text color={state.isHovered ? C.accentSoft : C.accent} inverse bold>
      {` ${props.label} `}
    </Text>
  )
}

export default Pill
