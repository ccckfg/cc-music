// 封面：下载封面，用 ffmpeg 缩到长边不超过 SIZE、保持原比例，交出 RGB 像素。
// 裁切和画成字符都在 mod 里做，它知道面板有多大。
import { spawn } from 'node:child_process'

import { log } from './log.ts'
import type { CoverResponse, Track } from './protocol.ts'
import { fetchWithTimeout } from './providers/types.ts'

const CACHE_SIZE = 50
const FFMPEG_TIMEOUT_MS = 10_000
/** 长边的像素数：最宽的侧边栏封面约 40 格，每格 4–6 个像素已经够用 */
const SIZE = 256

export class CoverService {
  private readonly ffmpegPath: string | undefined
  private readonly cache = new Map<string, Promise<CoverResponse>>()

  constructor(ffmpegPath: string | undefined) {
    this.ffmpegPath = ffmpegPath
  }

  get(track: Track): Promise<CoverResponse> {
    const key = `${track.provider}:${track.id}`
    const hit = this.cache.get(key)
    if (hit) return hit
    const pending = this.render(track)
      .then(image => ({ key, ...image }))
      .catch(error => {
        log('warn', `封面失败：${track.title}`, error)
        this.cache.delete(key)
        return { key, width: 0, height: 0, pixels: null }
      })
    this.cache.set(key, pending)
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string)
    return pending
  }

  private async render(track: Track): Promise<Omit<CoverResponse, 'key'>> {
    if (!track.thumbnail || !this.ffmpegPath) return { width: 0, height: 0, pixels: null }
    const response = await fetchWithTimeout(track.thumbnail, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!response.ok) throw new Error(`下载封面失败：HTTP ${response.status}`)
    const ppm = await this.decode(Buffer.from(await response.arrayBuffer()))

    // PPM（P6）：文本头 "P6 宽 高 255" 后面跟一个空白，然后是 RGB 像素
    const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.subarray(0, 32).toString('latin1'))
    if (!header) throw new Error('ffmpeg 输出不是 PPM')
    const width = Number(header[1])
    const height = Number(header[2])
    const pixels = ppm.subarray(header[0].length, header[0].length + width * height * 3)
    if (pixels.length < width * height * 3) throw new Error(`ffmpeg 输出不完整：${pixels.length} 字节`)
    return { width, height, pixels: pixels.toString('base64') }
  }

  /** 任意格式的图片 → 长边不超过 SIZE 的 PPM（不放大）。 */
  private decode(image: Buffer): Promise<Buffer> {
    const args = [
      '-v', 'error',
      '-i', 'pipe:0',
      '-vf', `scale='min(${SIZE},iw)':'min(${SIZE},ih)':force_original_aspect_ratio=decrease:flags=area`,
      '-frames:v', '1',
      '-f', 'image2pipe',
      '-c:v', 'ppm',
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
