import type { Innertube } from 'youtubei.js'

import type { Config } from '../config.ts'
import type { Track } from '../protocol.ts'
import type { MusicProvider } from './types.ts'

const REQUEST_TIMEOUT_MS = 10_000

/** youtubei.js 搜索结果里我们用到的字段；库的类型随版本变化，这里只取最小形状。 */
type SongItem = {
  id?: string;
  title?: string;
  item_type?: string;
  artists?: { name: string }[];
  album?: { name?: string };
  duration?: { seconds?: number };
  thumbnails?: { url: string }[];
}

type Shelf = { contents?: SongItem[] }

export class YouTubeMusicProvider implements MusicProvider {
  readonly id = 'ytmusic'
  readonly name = 'YouTube Music'
  readonly aliases = ['yt', 'ytm', 'youtube']

  private client: Promise<Innertube> | undefined
  private readonly config: Config

  constructor(config: Config) {
    this.config = config
  }

  note(): string | undefined {
    const hasCookies = Boolean(this.config.cookiesFromBrowser || this.config.cookiesFile)
    return hasCookies ? undefined : '播放可能被 YouTube 的机器人验证拦截，需要在 config.json 里配置 cookies'
  }

  async search(query: string, limit: number): Promise<Track[]> {
    const client = await this.getClient()
    const result = await client.music.search(query, { type: 'song' })
    const shelf = (result.contents?.[0] ?? undefined) as Shelf | undefined
    return (shelf?.contents ?? [])
      .filter(item => item.id && item.title && (item.item_type === undefined || item.item_type === 'song' || item.item_type === 'video'))
      .slice(0, limit)
      .map(item => {
        const track: Track = {
          provider: this.id,
          id: item.id ?? '',
          title: item.title ?? '',
          artists: (item.artists ?? []).map(artist => artist.name),
          pageUrl: `https://music.youtube.com/watch?v=${item.id}`,
        }
        if (item.album?.name) track.album = item.album.name
        if (item.duration?.seconds) track.durationSec = item.duration.seconds
        const thumbnail = item.thumbnails?.[0]?.url
        if (thumbnail) track.thumbnail = thumbnail
        return track
      })
  }

  streamUrl(track: Track): string {
    return `https://music.youtube.com/watch?v=${track.id}`
  }

  private getClient(): Promise<Innertube> {
    // youtubei.js 很大，用到才加载，daemon 启动快很多。
    // 默认 fetch 没有超时，网络异常时会一直挂起，所以换成带超时的
    this.client ??= import('youtubei.js')
      .catch(() => {
        // 插件市场安装时由 Claude Code 装好依赖；从源码运行时要自己 npm install
        throw new Error('缺少依赖 youtubei.js：在 cc-music 目录里运行 npm install 后 /music restart')
      })
      .then(({ Innertube }) =>
        Innertube.create({
          retrieve_player: false,
          lang: 'zh-CN',
          fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
        }),
      )
      .catch(error => {
        this.client = undefined
        throw error
      })
    return this.client
  }
}
