// cc-music daemon 入口：通常由 launch.ts 以独立进程拉起，也可以 `npm run daemon` 前台运行调试。
import { randomBytes } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'

import { loadConfig, resolveTool } from './config.ts'
import { CoverService } from './cover.ts'
import { Library } from './library.ts'
import { log } from './log.ts'
import { LyricsService } from './lyrics/index.ts'
import { DAEMON_FILE, VERSION } from './paths.ts'
import { Player } from './player/player.ts'
import type { DaemonInfo } from './protocol.ts'
import { ProviderRegistry } from './providers/index.ts'
import { createApiServer } from './server.ts'

const IDLE_CHECK_MS = 60_000

const config = loadConfig()
const registry = new ProviderRegistry(config)
const library = new Library()
const player = new Player(registry, config, track => library.addHistory(track))
const lyrics = new LyricsService()
const covers = new CoverService(resolveTool(config.ffmpegPath, 'CC_MUSIC_FFMPEG', 'ffmpeg', 'shims/ffmpeg.exe'))
const token = randomBytes(24).toString('hex')

let lastActivity = Date.now()
let isShuttingDown = false

const server = createApiServer({
  token,
  player,
  registry,
  lyrics,
  covers,
  library,
  onActivity: () => {
    lastActivity = Date.now()
  },
  onShutdown: () => void shutdown('收到 /shutdown'),
})

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address() as AddressInfo
  const info: DaemonInfo = { pid: process.pid, port, token, version: VERSION, startedAt: new Date().toISOString() }
  writeFileSync(DAEMON_FILE, JSON.stringify(info, null, 2), { mode: 0o600 })
  log('info', `daemon ${VERSION} 已启动，pid ${process.pid}，端口 ${port}`)
})

const idleTimer = setInterval(() => {
  if (config.idleExitMinutes <= 0 || player.isBusy) {
    if (player.isBusy) lastActivity = Date.now()
    return
  }
  if (Date.now() - lastActivity > config.idleExitMinutes * 60_000) void shutdown(`空闲超过 ${config.idleExitMinutes} 分钟`)
}, IDLE_CHECK_MS)

async function shutdown(reason: string): Promise<void> {
  if (isShuttingDown) return
  isShuttingDown = true
  log('info', `daemon 退出：${reason}`)
  clearInterval(idleTimer)
  server.close()
  await player.shutdown().catch(error => log('warn', '关闭 mpv 失败', error))
  library.flush()
  removeOwnDaemonFile()
  process.exit(0)
}

/** 只删自己写的 daemon.json：新 daemon 可能已经覆盖了它。 */
function removeOwnDaemonFile(): void {
  try {
    const info = JSON.parse(readFileSync(DAEMON_FILE, 'utf8')) as DaemonInfo
    if (info.pid === process.pid) rmSync(DAEMON_FILE)
  } catch {
    // 文件不在或读不了，都不用管
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
  process.on(signal, () => void shutdown(signal))
}
process.on('uncaughtException', error => {
  log('error', '未捕获的异常', error)
  void shutdown('未捕获的异常')
})
process.on('unhandledRejection', error => log('error', '未处理的 Promise 拒绝', error))
