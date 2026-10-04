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

/** 设置页能改的 daemon 配置项（~/.cc-music/config.json 的一部分） */
export type DaemonSettings = {
  /** 不带前缀搜索时用的音源 id */
  defaultProvider: string;
  /** daemon 启动时的音量 0–100 */
  volume: number;
  /** 交给 yt-dlp 的 cookies 文件（Netscape 格式），空字符串表示不用 */
  cookiesFile: string;
  /** 没在播放、也没有请求多少分钟后自动退出，0 表示不退出 */
  idleExitMinutes: number;
};

/** `POST /config` 的请求：只带要改的项 */
export type ConfigPatch = Partial<DaemonSettings>;

/** `GET /config`、`POST /config` 的回复 */
export type ConfigResponse = {
  settings: DaemonSettings;
  /** config.json 的位置 */
  configFile: string;
  /** 配置了 cookies 文件且文件存在 */
  hasCookiesFile: boolean;
  /** 找到的外部工具，找不到为 null */
  tools: { mpv: string | null; ytdlp: string | null; ffmpeg: string | null };
};

/** `POST /cover` 的回复：保持原图比例、长边不超过 256 的 RGB 像素。没有封面时 pixels 为 null、宽高为 0。 */
export type CoverResponse = {
  key: string;
  width: number;
  height: number;
  /** width*height 个像素，每个 R、G、B 三字节，逐行排列，base64 */
  pixels: string | null;
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
export type PaneTab = 'now' | 'search' | 'queue' | 'favorites' | 'history' | 'settings';

/** mod 这边的偏好，存在 $.store 里，跨会话保留 */
export type Prefs = {
  /** 输入框上方显示迷你播放器 */
  showMiniPlayer: boolean;
  /** 开始放歌时自动打开侧边栏（只在能停靠时） */
  autoOpenSidebar: boolean;
  /** 面板里显示封面 */
  showCover: boolean;
};

/** 设置页从 daemon 读到的配置；config 为 null 时还没读到，error 是读取或保存失败的原因 */
export type SettingsState = {
  config: ConfigResponse | null;
  error: string | null;
};

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
      prefs: Prefs;
      isPaneOpen: boolean;
      paneTab: PaneTab;
      search: SearchState;
      lyrics: LyricsState | null;
      cover: CoverResponse | null;
      library: LibraryResponse | null;
      /** 正在运行的 daemon 的版本；没在运行时为 null */
      daemonVersion: string | null;
      /** 设置页的内容；还没打开过设置页时为 null */
      settings: SettingsState | null;
    };
  }
}
