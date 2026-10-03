import type { LyricLine, Track } from '../protocol.ts'

export type LyricsResult = {
  synced: LyricLine[] | null;
  plain: string | null;
}

/** 一个歌词来源。新增来源（网易云、本地 .lrc……）实现它并在 lyrics/index.ts 里登记。 */
export interface LyricsProvider {
  readonly id: string;
  /** 找不到返回 null；网络错误抛出 */
  find(track: Track): Promise<LyricsResult | null>;
}

/** 解析 LRC：`[01:23.45]歌词`，一行可以有多个时间标签；元信息行（[ar:...]）忽略。 */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)]
    if (stamps.length === 0) continue
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    if (!text) continue
    for (const stamp of stamps) {
      const time = Number(stamp[1]) * 60 + Number((stamp[2] ?? '0').replace(':', '.'))
      if (Number.isFinite(time)) lines.push({ time, text })
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}
