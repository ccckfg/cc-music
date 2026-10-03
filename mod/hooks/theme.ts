// cc-music 的配色和排版小工具：Claude Code 主题色、终端里的文字宽度、按宽度折行。

/**
 * 颜色一律用 Claude Code 自己的主题色名（Text 的 color 接受主题键），
 * 用户切换亮色、暗色、色盲友好等主题时跟着变，和 Claude Code 本身的界面一致。
 */
export const C = {
  /** Claude 的橙色：品牌、当前标签页、进度、当前歌词行 */
  accent: 'claude',
  /** 橙色的亮一档 */
  accentSoft: 'claudeShimmer',
  /** 输入框边框的灰：边框、分隔线 */
  border: 'promptBorder',
  /** 次要文字 */
  dim: 'inactive',
  /** 更淡的文字、进度条未播放部分 */
  faint: 'subtle',
  info: 'permission',
  success: 'success',
  warning: 'warning',
  error: 'error',
} as const

const isWide = (cp: number): boolean =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe6f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x1f300 && cp <= 0x1f64f) ||
  (cp >= 0x1f900 && cp <= 0x1f9ff) ||
  (cp >= 0x20000 && cp <= 0x3fffd)

const isZeroWidth = (cp: number): boolean =>
  (cp >= 0x300 && cp <= 0x36f) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)

function charWidth(char: string): number {
  const cp = char.codePointAt(0) ?? 0
  if (isZeroWidth(cp)) return 0
  return isWide(cp) ? 2 : 1
}

/** 一段文字在终端里占几格：中日韩和 emoji 占两格。 */
export function cellWidth(text: string): number {
  let width = 0
  for (const char of text) width += charWidth(char)
  return width
}

/** 截到 width 格以内，截掉时末尾加 `…`。 */
export function truncate(text: string, width: number): string {
  if (width <= 0) return ''
  if (cellWidth(text) <= width) return text
  let out = ''
  let used = 0
  for (const char of text) {
    const w = charWidth(char)
    if (used + w > width - 1) break
    out += char
    used += w
  }
  return `${out}…`
}

/**
 * 按 width 格折行：西文在空格处断，中日韩字符之间随处可断，单个太长的词硬断。
 * 用来把歌词、标题排成一行行再各自居中。
 */
export function wrapText(text: string, width: number): string[] {
  const max = Math.max(1, width)
  const lines: string[] = []
  // 切成“词”：连续的非空白西文算一个词，每个宽字符单独算一个，空白单独算
  const tokens = text.match(/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]|\s+|[^\sᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]+/g) ?? []
  let line = ''
  let used = 0
  const flush = () => {
    lines.push(line.trimEnd())
    line = ''
    used = 0
  }
  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      if (used > 0 && used < max) {
        line += ' '
        used += 1
      }
      continue
    }
    let rest = token
    while (rest) {
      const w = cellWidth(rest)
      if (used + w <= max) {
        line += rest
        used += w
        rest = ''
      } else if (used > 0) {
        flush()
      } else {
        // 一个词比整行还宽：硬断
        let head = ''
        let headWidth = 0
        for (const char of rest) {
          const cw = charWidth(char)
          if (headWidth + cw > max) break
          head += char
          headWidth += cw
        }
        line = head
        used = headWidth
        rest = rest.slice(head.length)
        flush()
      }
    }
  }
  if (line.trim()) flush()
  return lines.length > 0 ? lines : ['']
}
