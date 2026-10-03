import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { log } from './log.ts'
import type { Player } from './player/player.ts'
import { VERSION } from './paths.ts'
import type { HealthResponse, PlayerCommand, SearchRequest, SearchResponse } from './protocol.ts'
import type { ProviderRegistry } from './providers/index.ts'

const MAX_BODY_BYTES = 1024 * 1024
const DEFAULT_SEARCH_LIMIT = 10
const MAX_SEARCH_LIMIT = 30

export type ServerDeps = {
  token: string;
  player: Player;
  registry: ProviderRegistry;
  /** 每个改变状态的请求都调用，用于空闲退出计时 */
  onActivity: () => void;
  onShutdown: () => void;
}

class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * 只监听 127.0.0.1 的 HTTP 接口。每个请求都要带 `x-cc-music-token`；
 * 带 Origin 头的请求（浏览器发来的）一律拒绝，防止网页跨站控制播放器。
 */
export function createApiServer(deps: ServerDeps): Server {
  return createServer((request, response) => {
    handle(deps, request, response).catch(error => {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : String(error)
      if (status === 500) log('error', `${request.method} ${request.url} 失败`, error)
      send(response, status, { error: message })
    })
  })
}

async function handle(deps: ServerDeps, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.headers.origin !== undefined) throw new HttpError(403, '不接受浏览器请求')
  if (!isAuthorized(request, deps.token)) throw new HttpError(401, 'token 不对')

  const route = `${request.method} ${new URL(request.url ?? '/', 'http://localhost').pathname}`
  switch (route) {
    case 'GET /health': {
      const health: HealthResponse = { ok: true, pid: process.pid, version: VERSION }
      return send(response, 200, health)
    }
    case 'GET /state':
      return send(response, 200, deps.player.snapshot())
    case 'GET /providers':
      return send(response, 200, deps.registry.list())
    case 'POST /search': {
      deps.onActivity()
      const body = (await readJson(request)) as Partial<SearchRequest>
      const query = typeof body.query === 'string' ? body.query.trim() : ''
      if (!query) throw new HttpError(400, '搜索词不能为空')
      const limit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Number(body.limit) || DEFAULT_SEARCH_LIMIT))
      const provider = getProvider(deps.registry, body.provider)
      const tracks = await provider.search(query, limit)
      const result: SearchResponse = { provider: provider.id, tracks }
      return send(response, 200, result)
    }
    case 'POST /command': {
      deps.onActivity()
      const command = (await readJson(request)) as PlayerCommand
      if (typeof command?.type !== 'string') throw new HttpError(400, '缺少命令类型')
      for (const track of 'tracks' in command ? command.tracks : []) getProvider(deps.registry, track.provider)
      try {
        return send(response, 200, await deps.player.command(command))
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error))
      }
    }
    case 'POST /shutdown': {
      send(response, 200, { ok: true })
      deps.onShutdown()
      return
    }
    default:
      throw new HttpError(404, `没有这个接口：${route}`)
  }
}

function getProvider(registry: ProviderRegistry, id: string | undefined) {
  try {
    return registry.get(id)
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : String(error))
  }
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const given = request.headers['x-cc-music-token']
  if (typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '请求体太大')
    chunks.push(chunk as Buffer)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, '请求体不是合法的 JSON')
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return
  const text = JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  response.end(text)
}
