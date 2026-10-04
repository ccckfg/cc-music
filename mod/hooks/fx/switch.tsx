// 开关（Client）：圆头的拨动开关 ◖  ●◗。开着是橙色底、白色圆钮在右；关着是灰底、圆钮在左。
// 点一下切换（发 { action: 'pref' } 给 hooks）；右边一个“开 / 关”。
import type { ClientModule } from 'claude-code'

import { C } from '../theme.ts'
import { instanceOf } from './shared.ts'

export type SwitchProps = {
  /** 哪个偏好：消息里原样带回 */
  name: string;
  isOn: boolean;
}

type State = { props: SwitchProps; isHovered: boolean; redraws: number }

const Switch: ClientModule<SwitchProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = instanceOf<State>(surface, () => ({ props, isHovered: false, redraws: 0 }))
  state.props = props
  if (surface.state === undefined) {
    surface.setState(0)
    surface.onPointer(event => {
      if (event.type === 'down') surface.post({ action: 'pref', name: state.props.name, value: !state.props.isOn })
      const isHovered = event.type !== 'leave'
      if (isHovered !== state.isHovered) {
        state.isHovered = isHovered
        state.redraws += 1
        surface.setState(state.redraws)
      }
    })
    surface.onKey(event => {
      if (event.key === ' ' || event.key === 'return') surface.post({ action: 'pref', name: state.props.name, value: !state.props.isOn })
    })
  }
  const track = props.isOn ? (state.isHovered ? C.accentSoft : C.accent) : state.isHovered ? C.dim : C.faint
  return (
    <Box flexDirection="row">
      <Text color={track}>◖</Text>
      <Text backgroundColor={track} color={props.isOn ? '#ffffff' : C.dim} bold>
        {props.isOn ? '  ●' : '●  '}
      </Text>
      <Text color={track}>◗</Text>
      <Text color={props.isOn ? C.accent : C.faint} bold={props.isOn ? true : undefined}>
        {props.isOn ? ' 开' : ' 关'}
      </Text>
    </Box>
  )
}

export default Switch
