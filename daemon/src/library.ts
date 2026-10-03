// 收藏和播放历史，存在 ~/.cc-music/library.json。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { log } from './log.ts'
import { DATA_DIR } from './paths.ts'
import type { HistoryEntry, LibraryResponse, Track } from './protocol.ts'

const LIBRARY_FILE = join(DATA_DIR, 'library.json')
const MAX_HISTORY = 200
const MAX_FAVORITES = 1000
const SAVE_DELAY_MS = 500

const keyOf = (track: Track) => `${track.provider}:${track.id}`

export class Library {
  private favorites: Track[] = []
  private history: HistoryEntry[] = []
  private saveTimer: NodeJS.Timeout | undefined

  constructor() {
    try {
      const data = JSON.parse(readFileSync(LIBRARY_FILE, 'utf8')) as Partial<LibraryResponse>
      this.favorites = Array.isArray(data.favorites) ? data.favorites : []
      this.history = Array.isArray(data.history) ? data.history : []
    } catch {
      // 第一次运行，还没有文件
    }
  }

  snapshot(): LibraryResponse {
    return { favorites: this.favorites, history: this.history }
  }

  isFavorite(track: Track): boolean {
    const key = keyOf(track)
    return this.favorites.some(t => keyOf(t) === key)
  }

  setFavorite(track: Track, favorite: boolean): void {
    const key = keyOf(track)
    this.favorites = this.favorites.filter(t => keyOf(t) !== key)
    if (favorite) this.favorites = [track, ...this.favorites].slice(0, MAX_FAVORITES)
    this.scheduleSave()
  }

  /** 记一次播放；和最近一条是同一首时只更新时间。 */
  addHistory(track: Track): void {
    const entry: HistoryEntry = { track, playedAt: new Date().toISOString() }
    const rest = this.history[0] && keyOf(this.history[0].track) === keyOf(track) ? this.history.slice(1) : this.history
    this.history = [entry, ...rest].slice(0, MAX_HISTORY)
    this.scheduleSave()
  }

  /** 立刻写盘（退出前调用）。 */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    try {
      writeFileSync(LIBRARY_FILE, `${JSON.stringify(this.snapshot(), null, 2)}\n`)
    } catch (error) {
      log('warn', '保存 library.json 失败', error)
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS)
  }
}
