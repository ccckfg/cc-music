// 与 cc-music daemon 通信：找到它（~/.cc-music/daemon.json）、必要时拉起它、发 HTTP 请求。
import type {
  CoverResponse,
  DaemonInfo,
  LibraryResponse,
  LyricsResponse,
  PlayerCommand,
  PlayerSnapshot,
  ProviderInfo,
  SearchResponse,
  Track,
} from '../types'
import { errorText, type Host } from './host.ts'

/** 比 launch.ts 自己等 daemon 就绪的 30 秒多留一些 */
const LAUNCH_TIMEOUT_MS = 40_000

type LaunchResult = ({ status: 'running' | 'started' } & DaemonInfo) | { status: 'failed'; error: string }

/** 找到的 daemon；模块重载后重新读 daemon.json，不影响 daemon 本身。 */
let cached: DaemonInfo | undefined
let launching: Promise<DaemonInfo> | undefined
let providers: ProviderInfo[] | undefined

/** daemon 不可达（没在运行、刚退出），与 daemon 返回的业务错误区分开。 */
export class DaemonUnavailableError extends Error {}

async function readDaemonInfo(host: Host): Promise<DaemonInfo | undefined> {
  try {
    return JSON.parse(await host.readText(`${await host.dataDir()}/daemon.json`)) as DaemonInfo
  } catch {
    return undefined
  }
}

async function send<T>(host: Host, info: DaemonInfo, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let response
  try {
    response = await host.fetch(`http://127.0.0.1:${info.port}${path}`, {
      method,
      headers: { 'x-cc-music-token': info.token, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    throw new DaemonUnavailableError(errorText(error))
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(response.text)
  } catch {
    throw new Error(`daemon 返回了无法解析的内容（HTTP ${response.status}）`)
  }
  if (!response.ok) {
    const message = (parsed as { error?: string }).error ?? `HTTP ${response.status}`
    // 401：daemon 换过了（token 变了），按不可达处理以便重新读 daemon.json
    if (response.status === 401) throw new DaemonUnavailableError(message)
    throw new Error(message)
  }
  return parsed as T
}

/** 找到正在运行的 daemon；`launch` 为真时找不到就拉起一个。 */
export async function connect(host: Host, options: { launch: boolean }): Promise<DaemonInfo | undefined> {
  if (cached) return cached
  const found = await readDaemonInfo(host)
  if (found) {
    try {
      await send(host, found, 'GET', '/health')
      cached = found
      return found
    } catch {
      // daemon.json 是上一个已退出的 daemon 留下的
    }
  }
  if (!options.launch) return undefined
  launching ??= launch(host).finally(() => {
    launching = undefined
  })
  cached = await launching
  return cached
}

async function launch(host: Host): Promise<DaemonInfo> {
  const { node, script } = await host.launcher()
  let run
  try {
    run = await host.run([node, script], LAUNCH_TIMEOUT_MS)
  } catch (error) {
    throw new Error(`无法启动 cc-music daemon（${node} ${script}）：${errorText(error)}`)
  }
  const line = run.stdout.trim().split('\n').at(-1) ?? ''
  let result: LaunchResult
  try {
    result = JSON.parse(line) as LaunchResult
  } catch {
    throw new Error(`cc-music daemon 启动失败：${(run.stderr || run.stdout).trim().slice(0, 300)}`)
  }
  if (result.status === 'failed') throw new Error(`cc-music daemon 启动失败：${result.error}`)
  const { status: _status, ...info } = result
  return info
}

/** 调用 daemon；它刚重启过（端口、token 变了）时重新连接再试一次。 */
async function call<T>(host: Host, method: 'GET' | 'POST', path: string, body?: unknown, launchIfDown = true): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const info = await connect(host, { launch: launchIfDown })
    if (!info) throw new DaemonUnavailableError('cc-music daemon 没有在运行')
    try {
      return await send<T>(host, info, method, path, body)
    } catch (error) {
      if (!(error instanceof DaemonUnavailableError) || attempt > 0) throw error
      cached = undefined
    }
  }
}

/** 轮询用：不拉起 daemon，没在运行时返回 null。 */
export async function peekState(host: Host): Promise<PlayerSnapshot | null> {
  try {
    return await call<PlayerSnapshot>(host, 'GET', '/state', undefined, false)
  } catch (error) {
    if (error instanceof DaemonUnavailableError) return null
    throw error
  }
}

export function search(host: Host, query: string, provider?: string, limit?: number): Promise<SearchResponse> {
  return call(host, 'POST', '/search', { query, provider, limit })
}

export function command(host: Host, cmd: PlayerCommand): Promise<PlayerSnapshot> {
  return call(host, 'POST', '/command', cmd)
}

export async function listProviders(host: Host): Promise<ProviderInfo[]> {
  providers ??= await call<ProviderInfo[]>(host, 'GET', '/providers')
  return providers
}

/** 让 daemon 退出（连同 mpv）；没在运行时返回 false。 */
export async function shutdown(host: Host): Promise<boolean> {
  const info = await connect(host, { launch: false })
  if (!info) return false
  try {
    await send(host, info, 'POST', '/shutdown')
  } finally {
    cached = undefined
    providers = undefined
  }
  return true
}

/** mod 需要的 daemon 版本；更旧的 daemon 没有歌词、封面、收藏接口，`/music restart` 换新。 */
export const DAEMON_VERSION = '0.3.0'

/** 正在运行的 daemon 的版本；没在运行时 undefined。 */
export async function runningVersion(host: Host): Promise<string | undefined> {
  return (await connect(host, { launch: false }))?.version
}

export function lyrics(host: Host, track: Track): Promise<LyricsResponse> {
  return call(host, 'POST', '/lyrics', { track })
}

export function cover(host: Host, track: Track): Promise<CoverResponse> {
  return call(host, 'POST', '/cover', { track })
}

export function library(host: Host): Promise<LibraryResponse> {
  return call(host, 'GET', '/library')
}

export function setFavorite(host: Host, track: Track, favorite: boolean): Promise<LibraryResponse> {
  return call(host, 'POST', '/library/favorite', { track, favorite })
}
