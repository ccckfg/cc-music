import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

import { log } from './log.ts'
import { CONFIG_FILE } from './paths.ts'
import type { ConfigPatch, ConfigResponse } from './protocol.ts'

/** ~/.cc-music/config.json 的内容；空字符串表示“自动”。 */
export type Config = {
  /** 不带前缀搜索时用的音源 */
  defaultProvider: string;
  /** 启动音量 0–100 */
  volume: number;
  /** ffmpeg 可执行文件（画封面用），空则从 PATH 和 scoop 目录里找 */
  ffmpegPath: string;
  /** mpv 可执行文件，空则从 PATH 和 scoop 目录里找 */
  mpvPath: string;
  /** yt-dlp 可执行文件，空则从 PATH 和 scoop 目录里找 */
  ytdlpPath: string;
  /** 交给 yt-dlp `--js-runtimes` 的运行时，解析 YouTube 需要 */
  jsRuntime: string;
  /** 交给 yt-dlp `--cookies-from-browser`，如 `edge`、`chrome`、`firefox` */
  cookiesFromBrowser: string;
  /** 交给 yt-dlp `--cookies` 的 Netscape 格式 cookies 文件 */
  cookiesFile: string;
  /** 没在播放且没有请求多久后自动退出，0 表示不退出 */
  idleExitMinutes: number;
};

const DEFAULTS: Config = {
  defaultProvider: 'bilibili',
  volume: 60,
  mpvPath: '',
  ffmpegPath: '',
  ytdlpPath: '',
  jsRuntime: 'node',
  cookiesFromBrowser: '',
  cookiesFile: '',
  idleExitMinutes: 30,
}

/** 读配置；文件不存在时写一份默认的，方便用户找到并修改。 */
export function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, `${JSON.stringify(DEFAULTS, null, 2)}\n`)
    return { ...DEFAULTS }
  }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Partial<Config>
    return { ...DEFAULTS, ...raw }
  } catch (error) {
    log('warn', `config.json 解析失败，使用默认配置`, error)
    return { ...DEFAULTS }
  }
}

/** 在 PATH 里找可执行文件，Windows 上补全 .exe。 */
function findOnPath(name: string): string | undefined {
  const exts = process.platform === 'win32' ? ['.exe', '.com', ''] : ['']
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * 按“配置 → 环境变量 → PATH → scoop 默认目录”的顺序找一个工具。
 * scoop 装的 mpv 只把目录加进用户 PATH，已经在跑的进程看不到，所以要兜底。
 */
export function resolveTool(configured: string, envName: string, name: string, scoopRelative: string): string | undefined {
  if (configured) return configured
  const fromEnv = process.env[envName]
  if (fromEnv) return fromEnv
  const onPath = findOnPath(name)
  if (onPath) return onPath
  const scoop = join(process.env['SCOOP'] ?? join(homedir(), 'scoop'), scoopRelative)
  return existsSync(scoop) ? scoop : undefined
}

export function findMpv(config: Config): string | undefined {
  return resolveTool(config.mpvPath, 'CC_MUSIC_MPV', 'mpv', 'apps/mpv/current/mpv.exe')
}

export function findYtdlp(config: Config): string | undefined {
  return resolveTool(config.ytdlpPath, 'CC_MUSIC_YTDLP', 'yt-dlp', 'shims/yt-dlp.exe')
}

export function findFfmpeg(config: Config): string | undefined {
  return resolveTool(config.ffmpegPath, 'CC_MUSIC_FFMPEG', 'ffmpeg', 'shims/ffmpeg.exe')
}

/** 设置页看到的配置：能改的项、配置文件位置、cookies 文件在不在、找到的工具。 */
export function describeConfig(config: Config): ConfigResponse {
  return {
    settings: {
      defaultProvider: config.defaultProvider,
      volume: config.volume,
      cookiesFile: config.cookiesFile,
      idleExitMinutes: config.idleExitMinutes,
    },
    configFile: CONFIG_FILE,
    hasCookiesFile: config.cookiesFile !== '' && existsSync(config.cookiesFile),
    tools: { mpv: findMpv(config) ?? null, ytdlp: findYtdlp(config) ?? null, ffmpeg: findFfmpeg(config) ?? null },
  }
}

/**
 * 设置页改配置：逐项校验后改进 config（daemon 各处共用这个对象，所以立即生效），
 * 再写回 config.json，文件里的其他字段原样保留。有一项不合法就抛错，什么都不改。
 * `providerId` 把音源 id 或别名换成 id，不认识时返回 undefined。
 */
export function updateConfig(config: Config, patch: ConfigPatch, providerId: (idOrAlias: string) => string | undefined): void {
  const changes: Partial<Config> = {}
  if (patch.defaultProvider !== undefined) {
    const id = typeof patch.defaultProvider === 'string' ? providerId(patch.defaultProvider) : undefined
    if (!id) throw new Error(`没有音源 “${String(patch.defaultProvider)}”`)
    changes.defaultProvider = id
  }
  if (patch.volume !== undefined) changes.volume = wholeNumber(patch.volume, '启动音量', 0, 100)
  if (patch.idleExitMinutes !== undefined) changes.idleExitMinutes = wholeNumber(patch.idleExitMinutes, '空闲退出时间', 0, 24 * 60)
  if (patch.cookiesFile !== undefined) {
    if (typeof patch.cookiesFile !== 'string') throw new Error('cookies 文件要写成路径')
    // 资源管理器里“复制文件地址”会带上引号
    changes.cookiesFile = patch.cookiesFile.trim().replace(/^"(.*)"$/, '$1')
  }

  Object.assign(config, changes)
  let saved: Record<string, unknown>
  try {
    saved = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Record<string, unknown>
  } catch {
    // 文件不在或解析不了：按现在的配置重写一份
    saved = { ...config }
  }
  writeFileSync(CONFIG_FILE, `${JSON.stringify({ ...saved, ...changes }, null, 2)}\n`)
}

function wholeNumber(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${what}要在 ${min}–${max} 之间`)
  return Math.round(value)
}
