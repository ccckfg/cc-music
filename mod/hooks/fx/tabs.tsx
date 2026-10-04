// 标签栏（Client）：每个标签一个图标，当前标签是橙色的胶囊；鼠标移上去会亮，点一下切换；
// 最右边是 ⚙ 设置。下面一条细线，当前标签下面是橙色粗线，换标签时滑过去。
// 窄的时候只有当前标签带文字，其余只画图标。获得焦点后 ← → 也能切换。
import type { ClientModule, RenderElement } from 'claude-code'

import { C, cellWidth } from '../theme.ts'
import { hit, instanceOf, runs, type Span } from './shared.ts'

export type TabsProps = {
  tabs: { id: string; icon: string; label: string }[];
  /** 放在最右边的那一个（设置） */
  end: { id: string; icon: string; label: string };
  active: string;
  width: number;
}

const MS = 30
const FRAMES = 7

type Item = Span & { id: string; text: string }
type Slide = { x: number; w: number }
type State = { hovered?: string; from: Slide; to: Slide; frame: number; redraws: number; stop?: () => void; props: TabsProps; items: Item[] }

const Tabs: ClientModule<TabsProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const items = layout(props)
  const activeItem = items.find(item => item.id === props.active)
  const target: Slide = activeItem ? { x: activeItem.start, w: activeItem.end - activeItem.start } : { x: 0, w: 0 }
  const state = instanceOf<State>(surface, () => ({ from: target, to: target, frame: FRAMES, redraws: 0, props, items }))
  state.props = props
  state.items = items

  if (surface.state === undefined) {
    surface.setState(0)
    surface.onPointer(event => {
      const item = hit(state.items, event.x)
      if (event.type === 'down' && item) surface.post({ action: 'tab', tab: item.id })
      const hovered = event.type === 'leave' ? undefined : item?.id
      if (hovered !== state.hovered) {
        state.hovered = hovered
        state.redraws += 1
        surface.setState(state.redraws)
      }
    })
    surface.onKey(event => {
      const ids = state.items.map(item => item.id)
      const at = ids.indexOf(state.props.active)
      const step = event.key === 'right' ? 1 : event.key === 'left' ? -1 : 0
      if (step) surface.post({ action: 'tab', tab: ids[(at + step + ids.length) % ids.length] ?? state.props.active })
    })
  }
  // 换了标签：下划线从现在的位置滑过去；滑动时才开帧时钟
  if (target.x !== state.to.x || target.w !== state.to.w) {
    state.from = slideAt(state)
    state.to = target
    state.frame = 0
    state.stop ??= surface.every(MS, () => {
      state.frame += 1
      if (state.frame >= FRAMES) {
        state.stop?.()
        state.stop = undefined
      }
      state.redraws += 1
      surface.setState(state.redraws)
    })
  }

  const slide = slideAt(state)
  const lineStart = Math.round(slide.x)
  const lineEnd = Math.round(slide.x + slide.w)
  const line: [string, string][] = []
  for (let i = 0; i < props.width; i += 1) line.push(i >= lineStart && i < lineEnd ? ['━', C.accent] : ['─', C.faint])

  let cursor = 0
  const cells: RenderElement[] = []
  for (const item of items) {
    if (item.start > cursor) cells.push(<Text>{' '.repeat(item.start - cursor)}</Text>)
    const isActive = item.id === props.active
    const isHovered = item.id === state.hovered
    cells.push(
      isActive ? (
        <Text color={C.accent} inverse bold>
          {item.text}
        </Text>
      ) : (
        <Text color={isHovered ? C.accentSoft : C.dim} bold={isHovered ? true : undefined}>
          {item.text}
        </Text>
      ),
    )
    cursor = item.end
  }
  return (
    <Box flexDirection="column" width={props.width}>
      <Box flexDirection="row">{cells}</Box>
      <Box flexDirection="row">
        {runs(line).map(run => (
          <Text color={run.color}>{run.text}</Text>
        ))}
      </Box>
    </Box>
  )
}

/**
 * 每个标签怎么画，按宽度挑最舒展的一种：
 * 宽：都是“ 图标 文字 ”；中：当前的“ 图标 文字 ”，其余“图标 文字”隔两格或一格；窄：只有当前的带文字，其余“ 图标 ”。
 */
function layout(props: TabsProps): Item[] {
  const full = (tab: TabsProps['end']) => ` ${tab.icon} ${tab.label} `
  const tight = (tab: TabsProps['end']) => `${tab.icon} ${tab.label}`
  const short = (tab: TabsProps['end']) => ` ${tab.icon} `
  const endWidth = cellWidth(props.end.id === props.active ? full(props.end) : short(props.end)) + 1
  const widthOf = (draw: (tab: TabsProps['end']) => string, gap: number) =>
    props.tabs.reduce((sum, tab) => sum + cellWidth(tab.id === props.active ? full(tab) : draw(tab)), 0) + gap * (props.tabs.length - 1) + endWidth
  const styles: { draw: (tab: TabsProps['end']) => string; gap: number }[] = [
    { draw: full, gap: 0 },
    { draw: tight, gap: 2 },
    { draw: tight, gap: 1 },
  ]
  const style = styles.find(candidate => widthOf(candidate.draw, candidate.gap) <= props.width) ?? { draw: short, gap: 0 }
  const items: Item[] = []
  let x = 0
  for (const tab of props.tabs) {
    const isPill = tab.id === props.active
    const text = isPill ? full(tab) : style.draw(tab)
    // 中等宽度：普通标签之间空两格；挨着胶囊的只空一格（胶囊两头自带空格）
    const previous = items[items.length - 1]
    if (previous && style.gap > 0) x += isPill || previous.id === props.active ? 1 : style.gap
    items.push({ id: tab.id, text, start: x, end: x + cellWidth(text) })
    x += cellWidth(text)
  }
  // 设置贴着右边
  const endText = props.end.id === props.active ? full(props.end) : short(props.end)
  const endStart = Math.max(x + 1, props.width - cellWidth(endText))
  items.push({ id: props.end.id, text: endText, start: endStart, end: endStart + cellWidth(endText) })
  return items
}

function slideAt(state: State): Slide {
  const t = Math.min(1, state.frame / FRAMES)
  const ease = 1 - (1 - t) ** 3
  if (state.from.w === 0) return state.to
  return {
    x: state.from.x + (state.to.x - state.from.x) * ease,
    w: state.from.w + (state.to.w - state.from.w) * ease,
  }
}

export default Tabs
