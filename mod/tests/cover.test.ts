import { expect, test } from 'claude-code/testing'

import { coverCells } from '../hooks/cover.ts'

/** width×height 的图，每个像素的颜色由 paint(x, y) 给出（0xRRGGBB） */
function image(width: number, height: number, paint: (x: number, y: number) => number) {
  let binary = ''
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = paint(x, y)
      binary += String.fromCharCode((color >> 16) & 255, (color >> 8) & 255, color & 255)
    }
  }
  return { key: `test:${Math.random()}`, width, height, pixels: btoa(binary) }
}

/** Raster cells → [码点, 前景, 背景] 的列表 */
function decode(cells: string): [number, number, number][] {
  const binary = atob(cells)
  const word = (offset: number) =>
    (binary.charCodeAt(offset) | (binary.charCodeAt(offset + 1) << 8) | (binary.charCodeAt(offset + 2) << 16) | (binary.charCodeAt(offset + 3) << 24)) >>> 0
  const result: [number, number, number][] = []
  for (let offset = 0; offset < binary.length; offset += 12) result.push([word(offset), word(offset + 4), word(offset + 8)])
  return result
}

const BLACK = 0x000000
const WHITE = 0xffffff
const RED = 0xff0000
const GREEN = 0x00ff00
const BLUE = 0x0000ff

test('横向的边落在 3/8 格：用 ▅（下 5/8），上黑下白', () => {
  // 一格是 1:2，所以 8×16 的图正好画成一格，不用裁
  const cover = image(8, 16, (_, y) => (y < 6 ? BLACK : WHITE))
  expect(decode(coverCells(cover, 1, 1) ?? '')).toEqual([[0x2585, WHITE, BLACK]])
})

test('竖着的边落在 1/4 格：用 ▎（左 1/4），左红右蓝', () => {
  const cover = image(8, 16, x => (x < 2 ? RED : BLUE))
  expect(decode(coverCells(cover, 1, 1) ?? '')).toEqual([[0x258e, RED, BLUE]])
})

test('宽图居中裁成正方形，两边裁掉', () => {
  // 32×8 的图，中间 8 列是绿的；画成 4×2 格（正方形）只剩中间
  const cover = image(32, 8, x => (x >= 12 && x < 20 ? GREEN : RED))
  const cells = decode(coverCells(cover, 4, 2) ?? '')
  expect(cells).toHaveLength(8)
  for (const [, foreground, background] of cells) {
    expect(foreground).toBe(GREEN)
    expect(background).toBe(GREEN)
  }
})

test('只用 BMP 里的块元素，放大缩小都行；数据不对时返回 null', () => {
  const noisy = image(37, 23, (x, y) => ((x * 7919 + y * 104729) % 0xffffff) | 0)
  for (const [columns, rows] of [[24, 12], [3, 1], [40, 20]] as const) {
    const cells = decode(coverCells(noisy, columns, rows) ?? '')
    expect(cells).toHaveLength(columns * rows)
    for (const [codepoint] of cells) {
      expect(codepoint >= 0x2580 && codepoint <= 0x259f).toBe(true)
    }
  }
  expect(coverCells({ key: 'empty', width: 0, height: 0, pixels: null }, 4, 2)).toBeNull()
  expect(coverCells({ key: 'short', width: 4, height: 4, pixels: btoa('abc') }, 4, 2)).toBeNull()
})
