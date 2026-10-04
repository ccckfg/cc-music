// 歌词（Client）：卡拉 OK 式——正在唱的那句从左往右一点点染成 Claude 橙，
// 其余的按离当前句的远近变淡。播放位置两次轮询之间按帧往前推，染色是连续的。
import type { ClientModule } from 'claude-code'

import type { PlayerSnapshot } from '../../types'
import { C } from '../theme.ts'
import { clamp01, instanceOf, playhead, startFrames, type Playhead } from './shared.ts'

export type LyricsProps = {
  /** 已经按宽度折好的行：文字和它属于第几句 */
  rows: { text: string; line: number }[];
  /** 每句的开始时间（秒） */
  times: number[];
  position: number;
  duration: number | null;
  status: PlayerSnapshot['status'];
  width: number;
  /** 显示几行 */
  height: number;
}

const MS = 120
/** 最后一句没有下一句的开始时间，按这么长算 */
const LAST_LINE_SECONDS = 5

type State = Playhead & { props: LyricsProps }

const Lyrics: ClientModule<LyricsProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = instanceOf<State>(surface, () => ({ tick: 0, props }))
  state.props = props
  startFrames(surface, MS, state, () => state.props.status === 'playing')

  const position = playhead(state, props.position, props.status === 'playing', props.duration, MS)
  const current = currentLine(props.times, position)
  const shown = windowOf(props.rows, current, props.height)

  // 当前句唱到哪了：按时间比例算出染到第几个字
  const start = props.times[current] ?? 0
  const end = props.times[current + 1] ?? start + LAST_LINE_SECONDS
  const progress = current >= 0 ? clamp01((position - start) / Math.max(0.1, end - start)) : 0
  const currentRows = props.rows.filter(row => row.line === current)
  const totalChars = currentRows.reduce((sum, row) => sum + [...row.text].length, 0)
  let litChars = Math.round(progress * totalChars)

  return (
    <Box flexDirection="column" alignItems="center" width={props.width}>
      {shown.map(row => {
        if (row.line !== current) {
          const distance = Math.abs(row.line - current)
          return <Text color={distance === 1 ? undefined : distance <= 3 ? C.dim : C.faint}>{row.text}</Text>
        }
        const chars = [...row.text]
        const lit = Math.max(0, Math.min(chars.length, litChars))
        litChars -= chars.length
        return (
          <Box flexDirection="row">
            {lit > 0 ? (
              <Text color={C.accent} bold>
                {chars.slice(0, lit).join('')}
              </Text>
            ) : null}
            {lit < chars.length ? <Text bold>{chars.slice(lit).join('')}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}

/** 位置落在第几句（还没到第一句时为 -1） */
function currentLine(times: number[], position: number): number {
  let index = -1
  for (let i = 0; i < times.length; i += 1) {
    if ((times[i] ?? 0) <= position + 0.15) index = i
    else break
  }
  return index
}

/** 要显示的那几行：当前句放在窗口上方三分之一处，窗口从一句的开头开始（不从折行的半句开始） */
function windowOf(rows: LyricsProps['rows'], current: number, height: number): LyricsProps['rows'] {
  const first = Math.max(0, rows.findIndex(row => row.line === Math.max(0, current)))
  let start = Math.max(0, Math.min(first - Math.floor(height / 3), rows.length - height))
  while (start > 0 && start < first && rows[start]?.line === rows[start - 1]?.line) start += 1
  return rows.slice(start, start + height)
}

export default Lyrics
