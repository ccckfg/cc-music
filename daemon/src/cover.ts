// 封面转字符画：下载封面，用 ffmpeg 缩放裁成正方形，每格用 ▀ 画上下两个像素。
import { spawn } from 'node:child_process'

import { log } from './log.ts'
import type { CoverResponse, Track } from './protocol.ts'
import { fetchWithTimeout } from './providers/types.ts'

const UPPER_HALF_BLOCK = 0x2580
const CACHE_SIZE = 50
const FFMPEG_TIMEOUT_MS = 10_000
const MAX_COLUMNS = 64
const MAX_ROWS = 32

export class CoverService {
  private readonly ffmpegPath: string | undefined
  private readonly cache = new Map<string, Promise<CoverResponse>>()

  constructor(ffmpegPath: string | undefined) {
    this.ffmpegPath = ffmpegPath
  }

  get(track: Track, columns: number, rows: number): Promise<CoverResponse> {
    const cols = clamp(columns, 4, MAX_COLUMNS)
    const rws = clamp(rows, 2, MAX_ROWS)
    const key = `${track.provider}:${track.id}`
    const cacheKey = `${key}@${cols}x${rws}`
    const hit = this.cache.get(cacheKey)
    if (hit) return hit
    const pending = this.render(track, cols, rws)
      .then(cells => ({ key, columns: cols, rows: rws, cells }))
      .catch(error => {
        log('warn', `封面失败：${track.title}`, error)
        this.cache.delete(cacheKey)
        return { key, columns: cols, rows: rws, cells: null }
      })
    this.cache.set(cacheKey, pending)
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string)
    return pending
  }

  private async render(track: Track, columns: number, rows: number): Promise<string | null> {
    if (!track.thumbnail || !this.ffmpegPath) return null
    const response = await fetchWithTimeout(track.thumbnail, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!response.ok) throw new Error(`下载封面失败：HTTP ${response.status}`)
    const image = Buffer.from(await response.arrayBuffer())

    const width = columns
    const height = rows * 2
    const rgb = await this.decode(image, width, height)
    if (rgb.length < width * height * 3) throw new Error(`ffmpeg 输出不完整：${rgb.length} 字节`)

    const cells = Buffer.alloc(columns * rows * 12)
    const pixel = (x: number, y: number) => {
      const i = (y * width + x) * 3
      return ((rgb[i] ?? 0) << 16) | ((rgb[i + 1] ?? 0) << 8) | (rgb[i + 2] ?? 0)
    }
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        const offset = (row * columns + col) * 12
        cells.writeUInt32LE(UPPER_HALF_BLOCK, offset)
        cells.writeUInt32LE(pixel(col, row * 2), offset + 4)
        cells.writeUInt32LE(pixel(col, row * 2 + 1), offset + 8)
      }
    }
    return cells.toString('base64')
  }

  /** 任意格式的图片 → 居中裁成 width×height 的 rgb24 像素。 */
  private decode(image: Buffer, width: number, height: number): Promise<Buffer> {
    const args = [
      '-v', 'error',
      '-i', 'pipe:0',
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      'pipe:1',
    ]
    return new Promise((resolve, reject) => {
      const child = spawn(this.ffmpegPath ?? 'ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      const chunks: Buffer[] = []
      let stderr = ''
      const timer = setTimeout(() => child.kill(), FFMPEG_TIMEOUT_MS)
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', reject)
      child.on('close', code => {
        clearTimeout(timer)
        if (code === 0) resolve(Buffer.concat(chunks))
        else reject(new Error(`ffmpeg 退出码 ${code}：${stderr.trim().slice(0, 200)}`))
      })
      child.stdin.on('error', () => undefined)
      child.stdin.end(image)
    })
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(Number(value) || min)))
}
