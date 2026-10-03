import type { Track } from '../protocol.ts'

/**
 * 一个音源：负责搜索，以及告诉播放器去哪里取音频。
 *
 * 新增音源（本地文件、网易云……）只需实现这个接口并在 providers/index.ts 注册，
 * 播放器、HTTP 接口和 mod 都不用改。
 */
export interface MusicProvider {
  /** 短 id，出现在 Track.provider 和 `/music <id>:关键词` 前缀里 */
  readonly id: string;
  /** 给人看的名字 */
  readonly name: string;
  /** 前缀别名，如 `bili`、`yt` */
  readonly aliases: readonly string[];
  /** 给人看的提示（例如“播放需要 cookies”），没有则缺省 */
  note(): string | undefined;
  search(query: string, limit: number): Promise<Track[]>;
  /** mpv 能直接打开的地址；网页地址由 mpv 内置的 yt-dlp 解析 */
  streamUrl(track: Track): string;
}

/** 带超时的 fetch：网络不通时不让请求无限挂起。 */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  return fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) })
}
