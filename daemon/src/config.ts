import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

import { log } from './log.ts'
import { CONFIG_FILE } from './paths.ts'

/** ~/.cc-music/config.json 的内容；空字符串表示“自动”。 */
export type Config = {
  /** 不带前缀搜索时用的音源 */
  defaultProvider: string;
  /** 启动音量 0–100 */
  volume: number;
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
