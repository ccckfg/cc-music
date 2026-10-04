// 封面：daemon 给的是保持原图比例的 RGB 像素。这里按格子大小居中裁切、缩放，
// 再给每一格挑一个块字符和前景、背景两种颜色，让这一格看起来最接近原图。
//
// Raster 只收 BMP 里的字符，所以只用块元素（U+2580–259F）：象限，加上 1/8 粒度的横条、竖条，
// 边缘能落在 1/8 格上，比只用象限（1/2 格）清楚得多。
import type { CoverResponse } from '../types'

/** 终端一格的高宽比：正方形封面的行数是列数的一半 */
export const CELL_ASPECT = 2

/** 每格切成 8×8 个采样点：块字符的边都落在 1/8 格上 */
const GRID = 8
const SAMPLES = GRID * GRID
const FULL_BLOCK = 0x2588

/** 一个候选字符：码点，以及它的前景盖住哪些采样点 */
type Glyph = { codepoint: number; samples: number[] }

type Pixels = { r: Float32Array; g: Float32Array; b: Float32Array; width: number; height: number }

/** 每种“两色分法”只留一个字符（前景、背景对调算同一种） */
const GLYPHS: Glyph[] = [
  { codepoint: FULL_BLOCK, samples: region(0, GRID, 0, GRID) },
  // ▁▂▃▄▅▆▇：下 k/8
  ...[1, 2, 3, 4, 5, 6, 7].map(k => ({ codepoint: 0x2580 + k, samples: region(0, GRID, GRID - k, GRID) })),
  // ▏▎▍▌▋▊▉：左 k/8
  ...[1, 2, 3, 4, 5, 6, 7].map(k => ({ codepoint: 0x2590 - k, samples: region(0, k, 0, GRID) })),
  { codepoint: 0x2598, samples: region(0, 4, 0, 4) }, // ▘
  { codepoint: 0x259d, samples: region(4, 8, 0, 4) }, // ▝
  { codepoint: 0x2596, samples: region(0, 4, 4, 8) }, // ▖
  { codepoint: 0x2597, samples: region(4, 8, 4, 8) }, // ▗
  { codepoint: 0x259a, samples: [...region(0, 4, 0, 4), ...region(4, 8, 4, 8)] }, // ▚
]

const cache = new Map<string, string>()
const MAX_CACHE = 8

/** 封面画成 columns×rows 格的 Raster cells，居中裁成这个比例；没有封面或数据不对时返回 null。 */
export function coverCells(cover: CoverResponse, columns: number, rows: number): string | null {
  if (!cover.pixels || columns < 1 || rows < 1) return null
  const key = `${cover.key}@${columns}x${rows}`
  const hit = cache.get(key)
  if (hit) return hit

  const source = decodeRgb(cover.pixels, cover.width, cover.height)
  if (!source) return null
  const samples = resample(source, columns * GRID, rows * GRID, columns / (rows * CELL_ASPECT))
  const cells = encodeCells(samples, columns, rows)

  cache.set(key, cells)
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string)
  return cells
}

function region(x0: number, x1: number, y0: number, y1: number): number[] {
  const samples: number[] = []
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) samples.push(y * GRID + x)
  return samples
}

function decodeRgb(base64: string, width: number, height: number): Pixels | null {
  if (!(width > 0 && height > 0)) return null
  const binary = atob(base64)
  const count = width * height
  if (binary.length < count * 3) return null
  const pixels = blank(width, height)
  for (let i = 0; i < count; i += 1) {
    pixels.r[i] = binary.charCodeAt(i * 3)
    pixels.g[i] = binary.charCodeAt(i * 3 + 1)
    pixels.b[i] = binary.charCodeAt(i * 3 + 2)
  }
  return pixels
}

function blank(width: number, height: number): Pixels {
  const count = width * height
  return { r: new Float32Array(count), g: new Float32Array(count), b: new Float32Array(count), width, height }
}

/** 居中裁成 aspect（宽/高）再缩放到 toWidth×toHeight：先横向、再纵向。 */
function resample(source: Pixels, toWidth: number, toHeight: number, aspect: number): Pixels {
  const isWider = source.width / source.height > aspect
  const cropWidth = isWider ? source.height * aspect : source.width
  const cropHeight = isWider ? source.height : source.width / aspect
  const columns = taps((source.width - cropWidth) / 2, cropWidth, toWidth, source.width)
  const lines = taps((source.height - cropHeight) / 2, cropHeight, toHeight, source.height)

  const wide = blank(toWidth, source.height)
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < toWidth; x += 1) {
      for (const [index, weight] of columns[x] ?? []) {
        const from = y * source.width + index
        const to = y * toWidth + x
        wide.r[to] = (wide.r[to] ?? 0) + (source.r[from] ?? 0) * weight
        wide.g[to] = (wide.g[to] ?? 0) + (source.g[from] ?? 0) * weight
        wide.b[to] = (wide.b[to] ?? 0) + (source.b[from] ?? 0) * weight
      }
    }
  }
  const out = blank(toWidth, toHeight)
  for (let y = 0; y < toHeight; y += 1) {
    for (const [index, weight] of lines[y] ?? []) {
      for (let x = 0; x < toWidth; x += 1) {
        const from = index * toWidth + x
        const to = y * toWidth + x
        out.r[to] = (out.r[to] ?? 0) + (wide.r[from] ?? 0) * weight
        out.g[to] = (out.g[to] ?? 0) + (wide.g[from] ?? 0) * weight
        out.b[to] = (out.b[to] ?? 0) + (wide.b[from] ?? 0) * weight
      }
    }
  }
  return out
}

/**
 * 一维缩放的权重：第 i 个输出取源里 [start + i*step, start + (i+1)*step) 这一段，按覆盖长度加权；
 * 放大时相当于线性插值。
 */
function taps(start: number, length: number, count: number, size: number): [number, number][][] {
  const step = length / count
  const result: [number, number][][] = []
  for (let i = 0; i < count; i += 1) {
    // 放大时窗口撑到一个像素宽，但不越过裁切边界
    const middle = start + (i + 0.5) * step
    const half = Math.max(step, 1) / 2
    const a = Math.max(start, middle - half)
    const b = Math.min(start + length, middle + half)
    const weights: [number, number][] = []
    let total = 0
    for (let p = Math.floor(a); p < Math.ceil(b); p += 1) {
      const weight = Math.min(b, p + 1) - Math.max(a, p)
      if (weight <= 0) continue
      weights.push([Math.min(size - 1, Math.max(0, p)), weight])
      total += weight
    }
    result.push(weights.map(([index, weight]) => [index, weight / total]))
  }
  return result
}

/** Raster 里“终端默认颜色”的写法 */
const DEFAULT_COLOR = 0x01000000

/** 四个角各用朝里的象限字符：左上 ▗、右上 ▖、左下 ▝、右下 ▘ */
function cornerOf(row: number, col: number, rows: number, columns: number): number | undefined {
  const isTop = row === 0
  const isBottom = row === rows - 1
  const isLeft = col === 0
  const isRight = col === columns - 1
  if (isTop && isLeft) return 0x2597
  if (isTop && isRight) return 0x2596
  if (isBottom && isLeft) return 0x259d
  if (isBottom && isRight) return 0x2598
  return undefined
}

/** 每格 64 个采样点分成前景、背景两组，挑颜色误差最小的字符，写成 [码点, 前景, 背景]；够大时四个角画成圆角。 */
function encodeCells(samples: Pixels, columns: number, rows: number): string {
  const isRounded = columns >= 6 && rows >= 3
  const bytes = new Uint8Array(columns * rows * 12)
  const put = (offset: number, value: number) => {
    bytes[offset] = value & 255
    bytes[offset + 1] = (value >>> 8) & 255
    bytes[offset + 2] = (value >>> 16) & 255
    bytes[offset + 3] = (value >>> 24) & 255
  }
  const r = new Float32Array(SAMPLES)
  const g = new Float32Array(SAMPLES)
  const b = new Float32Array(SAMPLES)

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      let tr = 0
      let tg = 0
      let tb = 0
      for (let s = 0; s < SAMPLES; s += 1) {
        const i = (row * GRID + Math.floor(s / GRID)) * samples.width + col * GRID + (s % GRID)
        r[s] = samples.r[i] ?? 0
        g[s] = samples.g[i] ?? 0
        b[s] = samples.b[i] ?? 0
        tr += r[s] ?? 0
        tg += g[s] ?? 0
        tb += b[s] ?? 0
      }

      // 误差 = 总平方和 − 两组各自的“和² / 个数”；总平方和对每种分法都一样，只比后一项
      let best = { score: -1, glyph: GLYPHS[0] as Glyph, sr: tr, sg: tg, sb: tb }
      for (const glyph of GLYPHS) {
        let sr = 0
        let sg = 0
        let sb = 0
        for (const s of glyph.samples) {
          sr += r[s] ?? 0
          sg += g[s] ?? 0
          sb += b[s] ?? 0
        }
        const n = glyph.samples.length
        const m = SAMPLES - n
        const score = (sr * sr + sg * sg + sb * sb) / n + (m > 0 ? ((tr - sr) ** 2 + (tg - sg) ** 2 + (tb - sb) ** 2) / m : 0)
        if (score > best.score) best = { score, glyph, sr, sg, sb }
      }

      const offset = (row * columns + col) * 12
      const corner = isRounded ? cornerOf(row, col, rows, columns) : undefined
      if (corner !== undefined) {
        // 圆角：角上那格只画朝里的四分之一，其余透出终端背景
        put(offset, corner)
        put(offset + 4, rgb(tr / SAMPLES, tg / SAMPLES, tb / SAMPLES))
        put(offset + 8, DEFAULT_COLOR)
        continue
      }
      const n = best.glyph.samples.length
      const m = SAMPLES - n
      const foreground = rgb(best.sr / n, best.sg / n, best.sb / n)
      const background = m > 0 ? rgb((tr - best.sr) / m, (tg - best.sg) / m, (tb - best.sb) / m) : foreground
      put(offset, best.glyph.codepoint)
      put(offset + 4, foreground)
      put(offset + 8, background)
    }
  }

  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function rgb(r: number, g: number, b: number): number {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
  return (channel(r) << 16) | (channel(g) << 8) | channel(b)
}
