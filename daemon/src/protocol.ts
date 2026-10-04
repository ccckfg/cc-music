// daemon 与 mod 之间的 HTTP 协议。
// mod 那一侧的副本在 types/index.d.ts：改这里时同步改那里。

/** 一首可播放的曲目，由某个音源产出。 */
export type Track = {
  /** 产出它的音源 id（`bilibili`、`ytmusic`） */
  provider: string;
  /** 音源内的唯一 id（B 站 bvid、YouTube videoId） */
  id: string;
  title: string;
  artists: string[];
  album?: string;
  /** 时长（秒），音源不知道时缺省 */
  durationSec?: number;
  /** 封面图 URL */
  thumbnail?: string;
  /** 在浏览器里打开的页面 */
  pageUrl: string;
};

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export type RepeatMode = 'off' | 'all' | 'one';

/** 播放器在某一刻的完整状态，`GET /state` 和每条命令都返回它。 */
export type PlayerSnapshot = {
  /** 结构性变化（换曲、队列、暂停、音量……）时递增；播放进度变化不递增 */
  version: number;
  status: PlayerStatus;
  /** 正在播放（或刚停下）的曲目 */
  current: Track | null;
  /** current 在 queue 里的下标，没有时为 -1 */
  index: number;
  queue: Track[];
  /** 播放进度（秒） */
  position: number;
  /** 曲目时长（秒），未知时为 null */
  duration: number | null;
  /** 0–100 */
  volume: number;
  repeat: RepeatMode;
  /** 最近一次失败的原因，成功播放后清空 */
  error: string | null;
};

export type ProviderInfo = {
  id: string;
  name: string;
  /** 搜索前缀可用的别名，如 `bili`、`yt` */
  aliases: string[];
  /** 是否是默认音源 */
  isDefault: boolean;
  /** 给人看的提示，如“播放需要 cookies” */
  note?: string;
};

export type SearchRequest = {
  query: string;
  /** 缺省用默认音源 */
  provider?: string;
  /** 缺省 10 */
  limit?: number;
};

export type SearchResponse = {
  provider: string;
  tracks: Track[];
};

export type PlayerCommand =
  | { type: 'play'; tracks: Track[]; start?: number }
  // next：插到当前曲目之后；play：插入后立即播放
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

export type HealthResponse = {
  ok: true;
  pid: number;
  version: string;
};

export type ErrorResponse = {
  error: string;
};

/** daemon 启动后写到 ~/.cc-music/daemon.json，mod 读它找到 daemon。 */
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

export type LyricsRequest = { track: Track };

/** 设置页能改的配置项（~/.cc-music/config.json 的一部分） */
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

export type CoverRequest = { track: Track };

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

export type FavoriteRequest = {
  track: Track;
  favorite: boolean;
};
