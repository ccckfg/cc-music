// 辅助模块能用的宿主能力。
//
// 引擎规定 `$` 只能在 hook 里以 `$.noun.method(...)` 的形式直接调用，不能当参数传出去，
// 所以 register.tsx 在 session.start 里用一组闭包把需要的能力包成 Host，
// daemon.ts、music.ts 只依赖 Host，不碰 `$`。
import type {
  CoverResponse,
  LastSearch,
  LibraryResponse,
  LyricsState,
  PaneTab,
  PlayerSnapshot,
  SearchState,
} from '../types'

export type HostResponse = { status: number; ok: boolean; text: string }

export type Host = {
  /** `$.http.fetch` */
  fetch: (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }) => Promise<HostResponse>;
  /** `$.fs.read`：读文本文件 */
  readText: (path: string) => Promise<string>;
  /** `$.process.run`：按 argv 运行命令（不经过 shell） */
  run: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /** cc-music 数据目录（默认 ~/.cc-music），daemon.json 在这里 */
  dataDir: () => Promise<string>;
  /** 拉起 daemon 用的 node 和 launch.ts 路径 */
  launcher: () => Promise<{ node: string; script: string }>;
  /** `$.clock.sleep` */
  sleep: (ms: number) => Promise<void>;
  /** 打开（或切到）cc-music 面板；返回是否已摆上屏幕 */
  openPane: () => Promise<boolean>;
  getPlayer: () => Promise<PlayerSnapshot | null>;
  setPlayer: (player: PlayerSnapshot | null) => Promise<void>;
  getLastSearch: () => Promise<LastSearch | null>;
  setLastSearch: (search: LastSearch) => Promise<void>;
  setBandHidden: (isHidden: boolean) => Promise<void>;
  isPaneOpen: () => Promise<boolean>;
  setPaneOpen: (isOpen: boolean) => Promise<void>;
  setPaneTab: (tab: PaneTab) => Promise<void>;
  setSearch: (search: SearchState) => Promise<void>;
  getLyrics: () => Promise<LyricsState | null>;
  setLyrics: (lyrics: LyricsState | null) => Promise<void>;
  getCover: () => Promise<CoverResponse | null>;
  setCover: (cover: CoverResponse | null) => Promise<void>;
  getLibrary: () => Promise<LibraryResponse | null>;
  setDaemonVersion: (version: string | null) => Promise<void>;
  setLibrary: (library: LibraryResponse) => Promise<void>;
  toast: (text: string, timeoutMs?: number) => void;
  /** 写一行调试日志（`claude --debug` 可见） */
  debug: (text: string) => void;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
