// 确保 daemon 在运行：已在运行就直接报告，否则以独立进程拉起并等它就绪。
// mod 通过 `node daemon/src/launch.ts` 调用它，读 stdout 的一行 JSON。
// 独立进程不随 Claude Code 会话或 mod 热重载退出，音乐不会因此中断。
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { isHealthy, readDaemonInfo } from './instance.ts'
import { DATA_DIR } from './paths.ts'
import type { DaemonInfo } from './protocol.ts'

/** 冷启动（磁盘缓存是凉的、杀毒软件在扫）时 Node 加载依赖可能要十几秒 */
const READY_TIMEOUT_MS = 30_000

type LaunchResult = ({ status: 'running' | 'started' } & DaemonInfo) | { status: 'failed'; error: string }

async function launch(): Promise<LaunchResult> {
  const existing = readDaemonInfo()
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
    const info = readDaemonInfo()
    if (info?.pid === pid && (await isHealthy(info))) return { status: 'started', ...info }
  }
  return { status: 'failed', error: `daemon 在 ${READY_TIMEOUT_MS / 1000} 秒内没有就绪，日志见 ${DATA_DIR}` }
}

const result = await launch()
process.stdout.write(`${JSON.stringify(result)}\n`)
process.exit(result.status === 'failed' ? 1 : 0)
