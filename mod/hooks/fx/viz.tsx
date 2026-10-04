// 频谱（Client）：一排随节拍跳动的柱子。播放时低频高、跟着“鼓点”一跳一跳，
// 起得快落得慢；暂停时慢慢落成一条淡淡的线。没有真的音频数据，样子按歌曲换种子。
import type { ClientModule } from 'claude-code'

import type { PlayerSnapshot } from '../../types'
import { C } from '../theme.ts'
import { clamp01, instanceOf, noise, runs, seedOf, startFrames } from './shared.ts'

export type VizProps = {
  status: PlayerSnapshot['status'];
  width: number;
  /** 柱子的高度（行），1 或 2 */
  rows: number;
  /** 换歌时换一种样子 */
  seed: string;
}

const MS = 90
/** 八分之一格的竖条：空、▁ … █ */
const BLOCKS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
/** 一拍几帧：6 帧 ≈ 0.54 秒，约 110 BPM */
const BEAT = 6
/** 暂停时柱子落到这么高，留一条线 */
const REST = 0.06

type State = { tick: number; props: VizProps; levels: number[] }

const Viz: ClientModule<VizProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = instanceOf<State>(surface, () => ({ tick: 0, props, levels: [] }))
  state.props = props
  startFrames(surface, MS, state, () => step(state))

  const width = Math.max(1, props.width)
  const rows = Math.max(1, Math.min(2, props.rows))
  const isPlaying = props.status === 'playing'
  const lines: [string, string | undefined][][] = []
  for (let row = rows - 1; row >= 0; row -= 1) {
    const cells: [string, string | undefined][] = []
    for (let i = 0; i < width; i += 1) {
      const level = state.levels[i] ?? REST
      const eighths = Math.round(level * rows * 8) - row * 8
      const block = BLOCKS[Math.max(row === 0 ? 1 : 0, Math.min(8, eighths))] ?? ' '
      // 播放时：高处的亮一档；暂停时整排淡掉
      const color = !isPlaying ? C.faint : level > 0.62 && (rows === 1 || row === rows - 1) ? C.accentSoft : C.accent
      cells.push([block, color])
    }
    lines.push(cells)
  }
  return (
    <Box flexDirection="column" width={width}>
      {lines.map(cells => (
        <Box flexDirection="row">
          {runs(cells).map(run => (
            <Text color={run.color}>{run.text}</Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

/** 走一帧：算每根柱子的目标高度再平滑过去；返回要不要重画 */
function step(state: State): boolean {
  const { width, status, seed } = state.props
  const isPlaying = status === 'playing'
  const base = seedOf(seed)
  const beat = Math.exp(-(state.tick % BEAT) / 1.6)
  let isMoving = false
  for (let i = 0; i < width; i += 1) {
    const current = state.levels[i] ?? REST
    let target = REST
    if (isPlaying) {
      const x = width > 1 ? i / (width - 1) : 0
      // 低频那头高，中间稍微鼓一点
      const profile = 0.42 + 0.5 * (1 - x) ** 1.3 + 0.18 * Math.exp(-((x - 0.45) ** 2) / 0.03)
      // 每三帧换一个随机值，中间平滑过渡
      const k = Math.floor(state.tick / 3)
      const t = (state.tick % 3) / 3
      const smooth = t * t * (3 - 2 * t)
      const wobble = noise(base, i, k) * (1 - smooth) + noise(base, i, k + 1) * smooth
      const kick = x < 0.4 ? 0.65 + 0.5 * beat : 0.85 + 0.2 * beat
      // 开个根号让中间的高度多一些，柱子更有起伏
      target = clamp01(profile * (0.12 + 0.98 * wobble) * kick * 1.1) ** 0.7
    }
    const next = current + (target - current) * (target > current ? 0.7 : 0.28)
    if (Math.abs(next - current) > 0.004) isMoving = true
    state.levels[i] = next
  }
  state.levels.length = width
  return isMoving
}

export default Viz
