import type { Track } from '../protocol.ts'
import { fetchWithTimeout } from '../providers/types.ts'
import { lyricsQueries } from '../text.ts'
import { parseLrc, type LyricsProvider, type LyricsResult } from './types.ts'

type Candidate = {
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/** 时长相差超过这么多秒就认为不是同一首（B 站 MV 常有片头，放宽一些） */
const MAX_DURATION_GAP = 30

/** LRCLIB（lrclib.net）：免费、不用 key、带时间轴歌词。 */
export class LrclibProvider implements LyricsProvider {
  readonly id = 'lrclib'

  async find(track: Track): Promise<LyricsResult | null> {
    // YouTube Music 的歌手字段可靠；B 站的“歌手”其实是 UP 主，不参与搜索
    const queries = lyricsQueries(track.title, track.artists, track.provider !== 'bilibili')
    for (const query of queries) {
      const best = this.pick(await this.search(query), track.durationSec)
      if (best) {
        const synced = best.syncedLyrics ? parseLrc(best.syncedLyrics) : []
        return { synced: synced.length > 0 ? synced : null, plain: best.plainLyrics ?? null }
      }
    }
    return null
  }

  private async search(query: string): Promise<Candidate[]> {
    const response = await fetchWithTimeout(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'cc-music/0.2.0' },
    })
    if (!response.ok) throw new Error(`LRCLIB 搜索失败：HTTP ${response.status}`)
    return (await response.json()) as Candidate[]
  }

  /** 先要有歌词，再按“有时间轴、时长最接近”挑。 */
  private pick(candidates: Candidate[], durationSec: number | undefined): Candidate | undefined {
    const usable = candidates.filter(c => !c.instrumental && (c.syncedLyrics || c.plainLyrics))
    const gap = (c: Candidate) => (durationSec && c.duration ? Math.abs(c.duration - durationSec) : 0)
    return usable
      .filter(c => gap(c) <= MAX_DURATION_GAP)
      .sort((a, b) => Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics)) || gap(a) - gap(b))[0]
  }
}
