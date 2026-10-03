import { log } from '../log.ts'
import type { LyricsResponse, Track } from '../protocol.ts'
import { LrclibProvider } from './lrclib.ts'
import type { LyricsProvider } from './types.ts'

const CACHE_SIZE = 100

/** 按顺序问各个歌词来源，结果按曲目缓存（找不到也缓存，免得反复搜）。 */
export class LyricsService {
  private readonly providers: LyricsProvider[] = [new LrclibProvider()]
  private readonly cache = new Map<string, Promise<LyricsResponse>>()

  get(track: Track): Promise<LyricsResponse> {
    const key = `${track.provider}:${track.id}`
    const hit = this.cache.get(key)
    if (hit) return hit
    const pending = this.lookup(key, track).catch(error => {
      // 网络错误不缓存，下次再试
      this.cache.delete(key)
      throw error
    })
    this.cache.set(key, pending)
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string)
    return pending
  }

  private async lookup(key: string, track: Track): Promise<LyricsResponse> {
    for (const provider of this.providers) {
      const found = await provider.find(track)
      if (found) {
        log('info', `歌词：${track.title} ← ${provider.id}（${found.synced ? `${found.synced.length} 行带时间` : '纯文本'}）`)
        return { key, synced: found.synced, plain: found.plain, source: provider.id }
      }
    }
    log('info', `歌词：${track.title} 没找到`)
    return { key, synced: null, plain: null, source: null }
  }
}
