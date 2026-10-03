import { createHash } from 'node:crypto'

import type { Track } from '../protocol.ts'
import { stripTags } from '../text.ts'
import { fetchWithTimeout, type MusicProvider } from './types.ts'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

/** B 站 WBI 签名的混淆表，见 bilibili-API-collect 的 wbi 文档。 */
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38,
  41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
]

/** 音乐分区的 tid：搜索先限定在这里，没结果再搜全站。 */
const MUSIC_TID = 3

const SESSION_TTL_MS = 60 * 60 * 1000

type Session = { cookie: string; mixinKey: string; expiresAt: number }

type SearchItem = {
  type?: string;
  bvid?: string;
  title?: string;
  author?: string;
  duration?: string;
  pic?: string;
}

type ApiResponse<T> = { code: number; message?: string; data?: T }

/** 搜索结果的标题带 `<em class="keyword">` 高亮和 HTML 实体，去掉它们。 */
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

/** `4:30`、`1:02:03` → 秒 */
function parseDuration(text: string | undefined): number | undefined {
  if (!text) return undefined
  const parts = text.split(':').map(Number)
  if (parts.some(Number.isNaN)) return undefined
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function md5(text: string): string {
  return createHash('md5').update(text).digest('hex')
}

export class BilibiliProvider implements MusicProvider {
  readonly id = 'bilibili'
  readonly name = '哔哩哔哩'
  readonly aliases = ['bili', 'b']

  private session: Session | undefined

  note(): string | undefined {
    return undefined
  }

  async search(query: string, limit: number): Promise<Track[]> {
    const inMusic = await this.searchVideos(query, MUSIC_TID)
    const items = inMusic.length > 0 ? inMusic : await this.searchVideos(query)
    return items.slice(0, limit).flatMap(item => {
      if (!item.bvid || !item.title) return []
      const track: Track = {
        provider: this.id,
        id: item.bvid,
        title: stripTags(plainText(item.title)),
        artists: item.author ? [item.author] : [],
        pageUrl: `https://www.bilibili.com/video/${item.bvid}`,
      }
      const durationSec = parseDuration(item.duration)
      if (durationSec !== undefined) track.durationSec = durationSec
      if (item.pic) track.thumbnail = item.pic.startsWith('//') ? `https:${item.pic}` : item.pic
      return [track]
    })
  }

  streamUrl(track: Track): string {
    return `https://www.bilibili.com/video/${track.id}`
  }

  private async searchVideos(keyword: string, tid?: number): Promise<SearchItem[]> {
    const session = await this.ensureSession()
    const params: Record<string, string | number> = { search_type: 'video', keyword, page: 1 }
    if (tid !== undefined) params['tids'] = tid
    const url = `https://api.bilibili.com/x/web-interface/wbi/search/type?${this.sign(params, session.mixinKey)}`
    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': UA, Referer: 'https://search.bilibili.com/', Cookie: session.cookie },
    })
    if (!response.ok) {
      // 412 是风控，换一个会话再试也大概率无用，直接报错让用户知道
      this.session = undefined
      throw new Error(`B 站搜索失败：HTTP ${response.status}`)
    }
    const body = (await response.json()) as ApiResponse<{ result?: SearchItem[] }>
    if (body.code !== 0) {
      this.session = undefined
      throw new Error(`B 站搜索失败：${body.message ?? body.code}`)
    }
    return (body.data?.result ?? []).filter(item => item.type === undefined || item.type === 'video')
  }

  /** 取 buvid cookie 和 WBI 混淆密钥，一小时内复用。 */
  private async ensureSession(): Promise<Session> {
    if (this.session && this.session.expiresAt > Date.now()) return this.session

    const headers = { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' }
    const spi = (await (await fetchWithTimeout('https://api.bilibili.com/x/frontend/finger/spi', { headers })).json()) as ApiResponse<{
      b_3?: string;
      b_4?: string;
    }>
    const cookie = [spi.data?.b_3 && `buvid3=${spi.data.b_3}`, spi.data?.b_4 && `buvid4=${spi.data.b_4}`].filter(Boolean).join('; ')

    // 未登录时 nav 返回 code -101，但 data.wbi_img 仍然有
    const nav = (await (await fetchWithTimeout('https://api.bilibili.com/x/web-interface/nav', { headers: { ...headers, Cookie: cookie } })).json()) as ApiResponse<{
      wbi_img?: { img_url: string; sub_url: string };
    }>
    const wbi = nav.data?.wbi_img
    if (!wbi) throw new Error('B 站搜索失败：拿不到 WBI 密钥')
    const keyOf = (url: string) => url.slice(url.lastIndexOf('/') + 1).split('.')[0] ?? ''
    const raw = keyOf(wbi.img_url) + keyOf(wbi.sub_url)
    const mixinKey = MIXIN_KEY_ENC_TAB.map(i => raw[i] ?? '').join('').slice(0, 32)

    this.session = { cookie, mixinKey, expiresAt: Date.now() + SESSION_TTL_MS }
    return this.session
  }

  /** WBI 签名：按键排序、去掉 `!'()*`、拼上混淆密钥取 md5。 */
  private sign(params: Record<string, string | number>, mixinKey: string): string {
    const all: Record<string, string | number> = { ...params, wts: Math.floor(Date.now() / 1000) }
    const query = Object.keys(all)
      .sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(all[key]).replace(/[!'()*]/g, ''))}`)
      .join('&')
    return `${query}&w_rid=${md5(query + mixinKey)}`
  }
}
