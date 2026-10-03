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

/** 最近一次搜索，`/music <序号>` 和 `/music add <序号>` 从这里取曲目。 */
export type LastSearch = {
  query: string;
  provider: string;
  tracks: Track[];
};

declare module 'claude-code' {
  interface PluginState {
    'cc-music': {
      /** daemon 报告的播放器状态；daemon 没在运行时为 null */
      player: PlayerSnapshot | null;
      lastSearch: LastSearch | null;
      /** 迷你播放器是否被用户隐藏 */
      isBandHidden: boolean;
    };
  }
}
