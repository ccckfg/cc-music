// 封面：把 daemon 给的半格字符画（▀，每格上下两个像素）还原成像素，
// 再按面板宽度缩放，用 2×2 象限字符（▘▚▙▛…）重画，横向分辨率翻倍。
import type { CoverResponse } from '../types'

/** 4 个象限的位：左上 8、右上 4、左下 2、右下 1。键是“前景色”那一组的位，左上总在前景里 */
const QUADRANT: Record<number, number> = {
  8: 0x2598, // ▘
  9: 0x259a, // ▚
  10: 0x258c, // ▌
  11: 0x2599, // ▙
  12: 0x2580, // ▀
  13: 0x259c, // ▜
  14: 0x259b, // ▛
  15: 0x2588, // █
}

type Rgb = [number, number, number]

const cache = new Map<string, string>()
const MAX_CACHE = 8

/** 封面画成 columns×rows 格的 Raster cells；源数据不对时返回 null。按（曲目, 尺寸）缓存。 */
export function coverCells(cover: CoverResponse, columns: number, rows: number): string | null {
  if (!cover.cells) return null
  const key = `${cover.key}@${columns}x${rows}`
  const hit = cache.get(key)
  if (hit) return hit

  const source = decodeHalfBlocks(cover.cells, cover.columns, cover.rows)
  if (!source) return null
  const pixels = resample(source.pixels, source.width, source.height, columns * 2, rows * 2)
  const cells = encodeQuadrants(pixels, columns, rows)

  cache.set(key, cells)
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string)
  return cells
}

/** ▀ 格子 → width×height 的像素（每格前景是上像素、背景是下像素）。 */
function decodeHalfBlocks(cells: string, columns: number, rows: number): { pixels: Rgb[]; width: number; height: number } | null {
  const binary = atob(cells)
  if (binary.length < columns * rows * 12) return null
  const word = (offset: number) =>
    (binary.charCodeAt(offset) | (binary.charCodeAt(offset + 1) << 8) | (binary.charCodeAt(offset + 2) << 16) | (binary.charCodeAt(offset + 3) << 24)) >>> 0
  const toRgb = (color: number): Rgb => [(color >> 16) & 255, (color >> 8) & 255, color & 255]

  const width = columns
  const height = rows * 2
  const pixels: Rgb[] = new Array<Rgb>(width * height)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const offset = (row * columns + col) * 12
      pixels[row * 2 * width + col] = toRgb(word(offset + 4))
      pixels[(row * 2 + 1) * width + col] = toRgb(word(offset + 8))
    }
  }
  return { pixels, width, height }
}

/** 缩小时取区域平均，放大时取最近的像素。 */
function resample(pixels: Rgb[], width: number, height: number, toWidth: number, toHeight: number): Rgb[] {
  const out: Rgb[] = new Array<Rgb>(toWidth * toHeight)
  const sx = width / toWidth
  const sy = height / toHeight
  for (let y = 0; y < toHeight; y += 1) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
    for (let x = 0; x < toWidth; x += 1) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let yy = y0; yy < Math.min(y1, height); yy += 1) {
        for (let xx = x0; xx < Math.min(x1, width); xx += 1) {
          const p = pixels[yy * width + xx]
          if (!p) continue
          r += p[0]
          g += p[1]
          b += p[2]
          n += 1
        }
      }
      out[y * toWidth + x] = n > 0 ? [r / n, g / n, b / n] : [0, 0, 0]
    }
  }
  return out
}

/** 每格 4 个像素分成两组颜色，挑误差最小的分法，写成 [码点, 前景, 背景]。 */
function encodeQuadrants(pixels: Rgb[], columns: number, rows: number): string {
  const width = columns * 2
  const bytes = new Uint8Array(columns * rows * 12)
  const put = (offset: number, value: number) => {
    bytes[offset] = value & 255
    bytes[offset + 1] = (value >>> 8) & 255
    bytes[offset + 2] = (value >>> 16) & 255
    bytes[offset + 3] = (value >>> 24) & 255
  }
  const pack = (c: Rgb) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2])

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const at = (dx: number, dy: number): Rgb => pixels[(row * 2 + dy) * width + col * 2 + dx] ?? [0, 0, 0]
      // 顺序与位一致：左上 8、右上 4、左下 2、右下 1
      const quad = [at(0, 0), at(1, 0), at(0, 1), at(1, 1)]
      let best = { mask: 15, error: Infinity, fg: quad[0] as Rgb, bg: quad[0] as Rgb }
      for (let mask = 8; mask <= 15; mask += 1) {
        const fgSet = quad.filter((_, i) => mask & (8 >> i))
        const bgSet = quad.filter((_, i) => !(mask & (8 >> i)))
        const fg = mean(fgSet)
        const bg = bgSet.length > 0 ? mean(bgSet) : fg
        const error = spread(fgSet, fg) + spread(bgSet, bg)
        if (error < best.error) best = { mask, error, fg, bg }
      }
      const offset = (row * columns + col) * 12
      put(offset, QUADRANT[best.mask] ?? 0x2588)
      put(offset + 4, pack(best.fg))
      put(offset + 8, pack(best.bg))
    }
  }

  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function mean(colors: Rgb[]): Rgb {
  const n = colors.length || 1
  return [
    colors.reduce((s, c) => s + c[0], 0) / n,
    colors.reduce((s, c) => s + c[1], 0) / n,
    colors.reduce((s, c) => s + c[2], 0) / n,
  ]
}

function spread(colors: Rgb[], center: Rgb): number {
  return colors.reduce((s, c) => s + (c[0] - center[0]) ** 2 + (c[1] - center[1]) ** 2 + (c[2] - center[2]) ** 2, 0)
}
