// daemon 与 mod 之间的 HTTP 协议。
// mod 那一侧的副本在 mod/types/index.d.ts：改这里时同步改那里。

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
