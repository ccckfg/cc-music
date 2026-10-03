import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs'

import { DATA_DIR, LOG_FILE } from './paths.ts'

const MAX_LOG_BYTES = 1024 * 1024

mkdirSync(DATA_DIR, { recursive: true })
rotate()

function rotate(): void {
  try {
    if (statSync(LOG_FILE).size > MAX_LOG_BYTES) renameSync(LOG_FILE, `${LOG_FILE}.1`)
  } catch {
    // 日志文件还不存在
  }
}

/** 写一行日志到 ~/.cc-music/daemon.log；daemon 没有终端，这是唯一的输出。 */
export function log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void {
  const suffix = detail === undefined ? '' : ` ${detail instanceof Error ? detail.stack ?? detail.message : JSON.stringify(detail)}`
  try {
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix}\n`)
  } catch {
    // 写不了日志也不能让播放器挂掉
  }
}
