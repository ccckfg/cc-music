import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { log } from '../log.ts'

/** mpv JSON IPC 推送的一条事件，如 `{ event: 'end-file', reason: 'eof' }`。 */
export type MpvEvent = { event: string } & Record<string, unknown>

export type MpvOptions = {
  mpvPath: string;
  ytdlpPath: string | undefined;
  volume: number;
  /** 追加给 yt-dlp 的选项，形如 `js-runtimes=node` */
  ytdlRawOptions: string[];
}

type Pending = { resolve: (data: unknown) => void; reject: (error: Error) => void }

const CONNECT_TIMEOUT_MS = 5000
const COMMAND_TIMEOUT_MS = 10_000

function ipcPath(): string {
  const name = `cc-music-mpv-${process.pid}`
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`)
}

/**
 * 一个常驻的 mpv 进程（`--idle`），通过 JSON IPC 控制。
 * Windows 上 IPC 走命名管道，其他平台走 Unix socket；Node 的 net.connect 两者通吃。
 */
export class Mpv extends EventEmitter<{
  event: [MpvEvent];
  property: [name: string, value: unknown];
  exit: [code: number | null];
}> {
  private readonly child: ChildProcess
  private readonly socket: Socket
  private readonly pending = new Map<number, Pending>()
  private nextRequestId = 1
  private buffer = ''
  private isClosed = false

  private constructor(child: ChildProcess, socket: Socket) {
    super()
    this.child = child
    this.socket = socket
    socket.setEncoding('utf8')
    socket.on('data', chunk => this.receive(String(chunk)))
    socket.on('error', error => log('warn', 'mpv IPC 出错', error))
    child.on('exit', code => {
      this.isClosed = true
      for (const { reject } of this.pending.values()) reject(new Error('mpv 已退出'))
      this.pending.clear()
      this.emit('exit', code)
    })
  }

  static async start(options: MpvOptions): Promise<Mpv> {
    const path = ipcPath()
    const args = [
      '--idle=yes',
      '--no-config',
      '--no-terminal',
      '--no-video',
      '--force-window=no',
      '--audio-display=no',
      '--sub-auto=no',
      '--sid=no',
      '--keep-open=no',
      '--input-default-bindings=no',
      '--cache=yes',
      `--input-ipc-server=${path}`,
      `--volume=${options.volume}`,
      '--volume-max=100',
      '--ytdl=yes',
      '--ytdl-format=bestaudio/best',
      ...options.ytdlRawOptions.map(option => `--ytdl-raw-options-append=${option}`),
    ]
    if (options.ytdlpPath) args.push(`--script-opts=ytdl_hook-ytdl_path=${options.ytdlpPath}`)

    log('info', `启动 mpv：${options.mpvPath}`, args)
    const child = spawn(options.mpvPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', text => log('warn', `mpv stderr: ${String(text).trim()}`))

    const spawned = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    await spawned

    const socket = await connectWithRetry(path, child)
    const mpv = new Mpv(child, socket)
    await mpv.command('request_log_messages', 'warn')
    return mpv
  }

  get isAlive(): boolean {
    return !this.isClosed
  }

  /** 发一条命令，等 mpv 回复；返回回复里的 data。 */
  command(...args: unknown[]): Promise<unknown> {
    if (this.isClosed) return Promise.reject(new Error('mpv 已退出'))
    const requestId = this.nextRequestId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`mpv 命令超时：${String(args[0])}`))
      }, COMMAND_TIMEOUT_MS)
      this.pending.set(requestId, {
        resolve: data => {
          clearTimeout(timer)
          resolve(data)
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.socket.write(`${JSON.stringify({ command: args, request_id: requestId })}\n`)
    })
  }

  observe(id: number, name: string): Promise<unknown> {
    return this.command('observe_property', id, name)
  }

  /** 让 mpv 自己退出，两秒内没退就强杀。 */
  async quit(): Promise<void> {
    if (this.isClosed) return
    const exited = new Promise<void>(resolve => this.child.once('exit', () => resolve()))
    this.command('quit').catch(() => undefined)
    const timer = setTimeout(() => this.child.kill(), 2000)
    await exited
    clearTimeout(timer)
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.dispatch(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private dispatch(line: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      log('warn', `mpv 发来无法解析的一行：${line}`)
      return
    }

    if (typeof message['request_id'] === 'number' && message['event'] === undefined) {
      const pending = this.pending.get(message['request_id'])
      if (!pending) return
      this.pending.delete(message['request_id'])
      if (message['error'] === 'success') pending.resolve(message['data'])
      else pending.reject(new Error(`mpv: ${String(message['error'])}`))
      return
    }

    if (typeof message['event'] !== 'string') return
    if (message['event'] === 'property-change' && typeof message['name'] === 'string') {
      this.emit('property', message['name'], message['data'])
      return
    }
    this.emit('event', message as MpvEvent)
  }
}

/** mpv 建好 IPC 管道需要一点时间，轮询连接直到成功、超时或 mpv 退出。 */
async function connectWithRetry(path: string, child: ChildProcess): Promise<Socket> {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS
  let lastError: unknown
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`mpv 启动后立即退出（退出码 ${child.exitCode}）`)
    try {
      return await new Promise<Socket>((resolve, reject) => {
        const socket = connect(path)
        socket.once('connect', () => resolve(socket))
        socket.once('error', reject)
      })
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  child.kill()
  throw new Error(`连不上 mpv 的 IPC 管道：${lastError instanceof Error ? lastError.message : String(lastError)}`)
}
