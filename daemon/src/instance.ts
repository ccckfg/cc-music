// 找到正在运行的 daemon：读 daemon.json，再用 /health 确认它还活着。launch.ts 和 main.ts 共用。
import { readFileSync } from 'node:fs'

import { DAEMON_FILE } from './paths.ts'
import type { DaemonInfo } from './protocol.ts'

const HEALTH_TIMEOUT_MS = 1500

export function readDaemonInfo(): DaemonInfo | undefined {
  try {
    return JSON.parse(readFileSync(DAEMON_FILE, 'utf8')) as DaemonInfo
  } catch {
    return undefined
  }
}

export async function isHealthy(info: DaemonInfo): Promise<boolean> {
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
