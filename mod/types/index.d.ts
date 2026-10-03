// cc-music 的类型约定：daemon HTTP 协议的副本，以及 mod 存在 $.state 里的值。
// 协议部分与 daemon/src/protocol.ts 保持一致：改那里时同步改这里。

export type Track = {
  provider: string;
  id: string;
  title: string;
  artists: string[];
  album?: string;
  durationSec?: number;
  thumbnail?: string;
  pageUrl: string;
};

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export type RepeatMode = 'off' | 'all' | 'one';

export type PlayerSnapshot = {
  version: number;
  status: PlayerStatus;
  current: Track | null;
  index: number;
  queue: Track[];
  position: number;
  duration: number | null;
  volume: number;
  repeat: RepeatMode;
  error: string | null;
};

export type ProviderInfo = {
  id: string;
  name: string;
  aliases: string[];
  isDefault: boolean;
  note?: string;
};

export type SearchResponse = {
  provider: string;
  tracks: Track[];
};

export type PlayerCommand =
  | { type: 'play'; tracks: Track[]; start?: number }
  | { type: 'enqueue'; tracks: Track[]; next?: boolean; play?: boolean }
  | { type: 'jump'; index: number }
  | { type: 'remove'; index: number }
  | { type: 'clear' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'stop' }
  | { type: 'seek'; seconds: number; relative?: boolean }
  | { type: 'volume'; value?: number; delta?: number }
  | { type: 'repeat'; mode: RepeatMode };

export type DaemonInfo = {
  pid: number;
  port: number;
  token: string;
  version: string;
  startedAt: string;
};

/** 一行带时间的歌词。 */
export type LyricLine = {
  /** 这一行开始的时间（秒） */
  time: number;
  text: string;
};

/** `POST /lyrics` 的回复；找不到歌词时 synced 和 plain 都是 null。 */
export type LyricsResponse = {
  /** 曲目的 `provider:id`，mod 用它丢弃过期的回复 */
  key: string;
  synced: LyricLine[] | null;
  plain: string | null;
  /** 歌词来源，如 `lrclib`；找不到时为 null */
  source: string | null;
};

/** `POST /cover` 的回复：可直接交给 Raster 的格子。没有封面时 cells 为 null。 */
export type CoverResponse = {
  key: string;
  columns: number;
  rows: number;
  /** RasterProps.cells 的格式：每格 [码点, 前景色, 背景色] 三个小端 u32，base64 */
  cells: string | null;
};

export type HistoryEntry = {
  track: Track;
  /** ISO 时间 */
  playedAt: string;
};

export type LibraryResponse = {
  favorites: Track[];
  /** 最近播放在前 */
  history: HistoryEntry[];
};


/** 最近一次搜索，`/music <序号>` 和 `/music add <序号>` 从这里取曲目。 */
export type LastSearch = {
  query: string;
  provider: string;
  tracks: Track[];
};

/** 面板的标签页 */
export type PaneTab = 'now' | 'search' | 'queue' | 'favorites' | 'history';

/** 面板搜索框的状态 */
export type SearchState = {
  query: string;
  isSearching: boolean;
  error: string | null;
};

/** 当前曲目的歌词；error 表示查找失败（网络等），和“没找到”区分 */
export type LyricsState = LyricsResponse & { error?: string };

declare module 'claude-code' {
  interface PluginState {
    'cc-music': {
      /** daemon 报告的播放器状态；daemon 没在运行时为 null */
      player: PlayerSnapshot | null;
      lastSearch: LastSearch | null;
      /** 迷你播放器是否被用户隐藏 */
      isBandHidden: boolean;
      isPaneOpen: boolean;
      paneTab: PaneTab;
      search: SearchState;
      lyrics: LyricsState | null;
      cover: CoverResponse | null;
      library: LibraryResponse | null;
      /** 正在运行的 daemon 的版本；没在运行时为 null */
      daemonVersion: string | null;
    };
  }
}
