// 确保 daemon 在运行：已在运行就直接报告，否则以独立进程拉起并等它就绪。
// mod 通过 `node daemon/src/launch.ts` 调用它，读 stdout 的一行 JSON。
// 独立进程不随 Claude Code 会话或 mod 热重载退出，音乐不会因此中断。
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { DAEMON_FILE, DATA_DIR } from './paths.ts'
import type { DaemonInfo } from './protocol.ts'

const READY_TIMEOUT_MS = 10_000
const HEALTH_TIMEOUT_MS = 1500

type LaunchResult = ({ status: 'running' | 'started' } & DaemonInfo) | { status: 'failed'; error: string }

function readInfo(): DaemonInfo | undefined {
  try {
    return JSON.parse(readFileSync(DAEMON_FILE, 'utf8')) as DaemonInfo
  } catch {
    return undefined
  }
}

async function isHealthy(info: DaemonInfo): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${info.port}/health`, {
      headers: { 'x-cc-music-token': info.token },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    return response.ok
  } catch {
    return false
  }
}

async function launch(): Promise<LaunchResult> {
  const existing = readInfo()
  if (existing && (await isHealthy(existing))) return { status: 'running', ...existing }

  mkdirSync(DATA_DIR, { recursive: true })
  const main = fileURLToPath(new URL('./main.ts', import.meta.url))
  const child = spawn(process.execPath, [main], {
    cwd: DATA_DIR,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  const pid = child.pid
  if (pid === undefined) return { status: 'failed', error: '无法启动 daemon 进程' }

  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 150))
    const info = readInfo()
    if (info?.pid === pid && (await isHealthy(info))) return { status: 'started', ...info }
  }
  return { status: 'failed', error: `daemon 在 ${READY_TIMEOUT_MS / 1000} 秒内没有就绪，日志见 ${DATA_DIR}` }
}

const result = await launch()
process.stdout.write(`${JSON.stringify(result)}\n`)
process.exit(result.status === 'failed' ? 1 : 0)
