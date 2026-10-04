// 画在空状态里的像素图标：每格用 ▀▄█ 画上下两个像素，交给 Raster。
// 颜色是 Raster 要的原始 RGB（不跟主题走），用 Claude 橙和几档灰，亮暗主题上都看得清。

/** 原始颜色；null 表示透明（用终端默认背景） */
type Pixel = number | null

const DEFAULT = 0x01000000
const ORANGE = 0xd77757
const ORANGE_LIGHT = 0xeb9f7f

export type IconName = 'vinyl' | 'heart' | 'list' | 'clock'

export type Icon = { columns: number; rows: number; cells: string }

const cache = new Map<IconName, Icon>()

/** 某个图标的 Raster 参数；按名字缓存 */
export function icon(name: IconName): Icon {
  const hit = cache.get(name)
  if (hit) return hit
  const pixels = name === 'vinyl' ? vinyl(20) : fromArt(ART[name])
  const made = encode(pixels)
  cache.set(name, made)
  return made
}

/** 14×12 的像素画：X 是橙色，o 是浅橙，其余透明 */
const ART: Record<Exclude<IconName, 'vinyl'>, string[]> = {
  heart: [
    '..XXX....XXX..',
    '.XoXXX..XXXXX.',
    'XoXXXXXXXXXXXX',
    'XXXXXXXXXXXXXX',
    'XXXXXXXXXXXXXX',
    '.XXXXXXXXXXXX.',
    '..XXXXXXXXXX..',
    '...XXXXXXXX...',
    '....XXXXXX....',
    '.....XXXX.....',
    '......XX......',
    '..............',
  ],
  list: [
    'oo.XXXXXXXXXXX',
    'oo.XXXXXXXXXXX',
    '..............',
    '..............',
    'oo.XXXXXXXXXXX',
    'oo.XXXXXXXXXXX',
    '..............',
    '..............',
    'oo.XXXXXXX....',
    'oo.XXXXXXX....',
    '..............',
    '..............',
  ],
  clock: [
    '....XXXXXX....',
    '..XX......XX..',
    '.X.....o....X.',
    'X......o.....X',
    'X......o.....X',
    'X......oooo..X',
    'X............X',
    'X............X',
    '.X..........X.',
    '..XX......XX..',
    '....XXXXXX....',
    '..............',
  ],
}

function fromArt(art: string[]): Pixel[][] {
  return art.map(line => [...line].map(char => (char === 'X' ? ORANGE : char === 'o' ? ORANGE_LIGHT : null)))
}

/**
 * 一张黑胶唱片：深色盘面、一圈圈纹路、一道反光，中间是橙色标签和小孔。
 * size 是直径（像素），画出来 size 列 × size/2 行。
 */
function vinyl(size: number): Pixel[][] {
  const pixels: Pixel[][] = []
  const center = (size - 1) / 2
  for (let y = 0; y < size; y += 1) {
    const row: Pixel[] = []
    for (let x = 0; x < size; x += 1) {
      const dx = (x - center) / (size / 2)
      const dy = (y - center) / (size / 2)
      const r = Math.sqrt(dx * dx + dy * dy)
      const angle = Math.atan2(dy, dx)
      if (r > 1) row.push(null)
      else if (r < 0.1) row.push(null)
      else if (r < 0.36) row.push(r < 0.2 ? ORANGE_LIGHT : ORANGE)
      else {
        // 纹路：每隔一圈亮一点；左上和右下各有一道反光
        const groove = Math.floor(r * 12) % 2 === 0 ? 0x1a1a1a : 0x222222
        const sheen = Math.abs(Math.sin(angle - Math.PI / 4)) > 0.92 ? 0x3a3a3a : groove
        row.push(r > 0.95 ? 0x2c2c2c : sheen)
      }
    }
    pixels.push(row)
  }
  return pixels
}

/** 像素 → Raster cells：每格上下两个像素，用 ▀ / ▄ / 空格表示 */
function encode(pixels: Pixel[][]): Icon {
  const columns = Math.max(...pixels.map(row => row.length))
  const rows = Math.ceil(pixels.length / 2)
  const bytes = new Uint8Array(columns * rows * 12)
  const put = (offset: number, value: number) => {
    bytes[offset] = value & 255
    bytes[offset + 1] = (value >>> 8) & 255
    bytes[offset + 2] = (value >>> 16) & 255
    bytes[offset + 3] = (value >>> 24) & 255
  }
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const top = pixels[row * 2]?.[col] ?? null
      const bottom = pixels[row * 2 + 1]?.[col] ?? null
      const offset = (row * columns + col) * 12
      if (top === null && bottom === null) {
        put(offset, 0x20)
        put(offset + 4, DEFAULT)
        put(offset + 8, DEFAULT)
      } else if (top === null) {
        put(offset, 0x2584) // ▄
        put(offset + 4, bottom ?? DEFAULT)
        put(offset + 8, DEFAULT)
      } else {
        put(offset, 0x2580) // ▀
        put(offset + 4, top)
        put(offset + 8, bottom ?? DEFAULT)
      }
    }
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { columns, rows, cells: btoa(binary) }
}
