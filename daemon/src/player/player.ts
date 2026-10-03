import { resolveTool, type Config } from '../config.ts'
import { log } from '../log.ts'
import type { PlayerCommand, PlayerSnapshot, PlayerStatus, RepeatMode, Track } from '../protocol.ts'
import type { ProviderRegistry } from '../providers/index.ts'
import { Mpv, type MpvEvent } from './mpv.ts'

const MAX_QUEUE = 500
/** 连续这么多首加载失败就停下，免得在坏队列里一直跳 */
const MAX_CONSECUTIVE_ERRORS = 3
/** 播放超过这么多秒时，“上一首”先回到本曲开头 */
const PREV_RESTART_SECONDS = 3

const OBSERVED = ['time-pos', 'duration', 'pause', 'volume'] as const

/**
 * 播放队列和播放状态。所有命令串行执行（一个 Promise 链），
 * mpv 的事件只更新状态，不和命令抢跑。
 */
export class Player {
  private readonly registry: ProviderRegistry
  private readonly config: Config

  private mpv: Mpv | undefined
  private starting: Promise<Mpv> | undefined
  private chain: Promise<unknown> = Promise.resolve()

  private version = 0
  private status: PlayerStatus = 'idle'
  private queue: Track[] = []
  private index = -1
  private position = 0
  private duration: number | null = null
  private volume: number
  private repeat: RepeatMode = 'off'
  private error: string | null = null

  /** 当前曲目在 mpv 播放列表里的 id，用来认出属于它的 end-file 事件 */
  private entryId: number | undefined
  private lastLoadError: string | undefined
  private consecutiveErrors = 0

  constructor(registry: ProviderRegistry, config: Config) {
    this.registry = registry
    this.config = config
    this.volume = clampVolume(config.volume)
  }

  /** 正在播放或加载时为 true，daemon 据此判断能否空闲退出。 */
  get isBusy(): boolean {
    return this.status === 'playing' || this.status === 'loading'
  }

  snapshot(): PlayerSnapshot {
    return {
      version: this.version,
      status: this.status,
      current: this.queue[this.index] ?? null,
      index: this.index,
      queue: this.queue,
      position: this.position,
      duration: this.duration,
      volume: this.volume,
      repeat: this.repeat,
      error: this.error,
    }
  }

  /** 执行一条命令，返回执行后的状态。命令按到达顺序一条条执行。 */
  command(command: PlayerCommand): Promise<PlayerSnapshot> {
    return this.schedule(() => this.execute(command)).then(() => this.snapshot())
  }

  /** 把一个任务排到串行链上：命令和 mpv 事件触发的切歌都走这里。 */
  private schedule(task: () => Promise<void>): Promise<void> {
    const run = this.chain.then(task)
    this.chain = run.catch(error => log('warn', '任务失败', error))
    return run
  }

  async shutdown(): Promise<void> {
    await this.mpv?.quit()
  }

  private async execute(command: PlayerCommand): Promise<void> {
    switch (command.type) {
      case 'play': {
        if (command.tracks.length === 0) throw new Error('没有可播放的曲目')
        this.queue = command.tracks.slice(0, MAX_QUEUE)
        this.index = clampIndex(command.start ?? 0, this.queue.length)
        this.consecutiveErrors = 0
        return this.load()
      }
      case 'enqueue': {
        if (command.tracks.length === 0) return
        const wasIdle = this.status === 'idle' || this.status === 'error' || this.index === -1
        const at = command.next && this.index >= 0 ? this.index + 1 : this.queue.length
        this.queue = [...this.queue.slice(0, at), ...command.tracks, ...this.queue.slice(at)].slice(0, MAX_QUEUE)
        this.bump()
        if (wasIdle) {
          this.index = at
          return this.load()
        }
        return
      }
      case 'jump': {
        if (!this.queue[command.index]) throw new Error(`队列里没有第 ${command.index + 1} 首`)
        this.index = command.index
        return this.load()
      }
      case 'remove': {
        if (!this.queue[command.index]) throw new Error(`队列里没有第 ${command.index + 1} 首`)
        this.queue = this.queue.filter((_, i) => i !== command.index)
        if (command.index < this.index) {
          this.index -= 1
        } else if (command.index === this.index) {
          if (this.queue[this.index]) return this.load()
          this.index = this.queue.length - 1
          return this.stop()
        }
        this.bump()
        return
      }
      case 'clear': {
        await this.stop()
        this.queue = []
        this.index = -1
        this.bump()
        return
      }
      case 'pause':
        return this.setPause(true)
      case 'resume':
        return this.status === 'idle' || this.status === 'error' ? this.load() : this.setPause(false)
      case 'toggle':
        if (this.status === 'idle' || this.status === 'error') return this.load()
        return this.setPause(this.status !== 'paused')
      case 'next':
        return this.advance(false)
      case 'prev': {
        if (this.position > PREV_RESTART_SECONDS || this.index <= 0) return this.seek(0, false)
        this.index -= 1
        return this.load()
      }
      case 'stop':
        return this.stop()
      case 'seek':
        return this.seek(command.seconds, command.relative ?? false)
      case 'volume': {
        const target = clampVolume(command.value ?? this.volume + (command.delta ?? 0))
        this.volume = target
        this.bump()
        if (this.mpv?.isAlive) await this.mpv.command('set_property', 'volume', target)
        return
      }
      case 'repeat': {
        this.repeat = command.mode
        this.bump()
        return
      }
    }
  }

  /** 播放 queue[index]。 */
  private async load(): Promise<void> {
    const track = this.queue[this.index]
    if (!track) return this.stop()

    this.status = 'loading'
    this.error = null
    this.position = 0
    this.duration = track.durationSec ?? null
    this.lastLoadError = undefined
    this.bump()

    try {
      const mpv = await this.ensureMpv()
      const url = this.registry.get(track.provider).streamUrl(track)
      log('info', `加载 ${track.provider}:${track.id} ${track.title}`)
      const reply = (await mpv.command('loadfile', url, 'replace')) as { playlist_entry_id?: number } | null
      this.entryId = reply?.playlist_entry_id
      await mpv.command('set_property', 'pause', false)
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  private async stop(): Promise<void> {
    this.entryId = undefined
    if (this.mpv?.isAlive) await this.mpv.command('stop')
    this.status = 'idle'
    this.position = 0
    this.bump()
  }

  private async setPause(paused: boolean): Promise<void> {
    if (!this.mpv?.isAlive || this.status === 'idle') return
    await this.mpv.command('set_property', 'pause', paused)
    // 不等 mpv 的 pause 属性事件，让这条命令的回复就是新状态
    if (this.status === 'playing' || this.status === 'paused') {
      this.status = paused ? 'paused' : 'playing'
      this.bump()
    }
  }

  private async seek(seconds: number, relative: boolean): Promise<void> {
    if (!this.mpv?.isAlive || this.status === 'idle') return
    await this.mpv.command('seek', seconds, relative ? 'relative' : 'absolute')
  }

  /** 下一首；isAuto 表示本曲自然播完（单曲循环只在这时生效）。 */
  private async advance(isAuto: boolean): Promise<void> {
    if (isAuto && this.repeat === 'one') return this.load()
    if (this.index + 1 < this.queue.length) {
      this.index += 1
      return this.load()
    }
    if (this.repeat === 'all' && this.queue.length > 0) {
      this.index = 0
      return this.load()
    }
    return this.stop()
  }

  private fail(message: string): void {
    log('warn', `播放失败：${message}`)
    this.status = 'error'
    this.error = message
    this.consecutiveErrors += 1
    this.bump()
  }

  private bump(): void {
    this.version += 1
  }

  private ensureMpv(): Promise<Mpv> {
    if (this.mpv?.isAlive) return Promise.resolve(this.mpv)
    this.starting ??= this.startMpv().finally(() => {
      this.starting = undefined
    })
    return this.starting
  }

  private async startMpv(): Promise<Mpv> {
    const mpvPath = resolveTool(this.config.mpvPath, 'CC_MUSIC_MPV', 'mpv', 'apps/mpv/current/mpv.exe')
    if (!mpvPath) throw new Error('找不到 mpv：请安装（scoop install mpv）或在 ~/.cc-music/config.json 里设置 mpvPath')
    const ytdlpPath = resolveTool(this.config.ytdlpPath, 'CC_MUSIC_YTDLP', 'yt-dlp', 'shims/yt-dlp.exe')
    if (!ytdlpPath) throw new Error('找不到 yt-dlp：请安装（scoop install yt-dlp）或在 ~/.cc-music/config.json 里设置 ytdlpPath')

    const ytdlRawOptions: string[] = []
    if (this.config.jsRuntime) ytdlRawOptions.push(`js-runtimes=${this.config.jsRuntime}`)
    if (this.config.cookiesFromBrowser) ytdlRawOptions.push(`cookies-from-browser=${this.config.cookiesFromBrowser}`)
    if (this.config.cookiesFile) ytdlRawOptions.push(`cookies=${this.config.cookiesFile}`)

    const mpv = await Mpv.start({ mpvPath, ytdlpPath, volume: this.volume, ytdlRawOptions })
    mpv.on('property', (name, value) => this.onProperty(name, value))
    mpv.on('event', event => this.onEvent(event))
    mpv.on('exit', code => {
      log('warn', `mpv 退出，退出码 ${code}`)
      if (this.mpv === mpv) this.mpv = undefined
      if (this.isBusy) this.fail('mpv 意外退出')
    })
    for (const [i, name] of OBSERVED.entries()) await mpv.observe(i + 1, name)
    this.mpv = mpv
    return mpv
  }

  private onProperty(name: string, value: unknown): void {
    switch (name) {
      case 'time-pos':
        if (typeof value === 'number') this.position = value
        return
      case 'duration':
        if (typeof value === 'number') this.duration = value
        return
      case 'pause':
        if (this.status === 'playing' && value === true) this.status = 'paused'
        else if (this.status === 'paused' && value === false) this.status = 'playing'
        else return
        this.bump()
        return
      case 'volume':
        if (typeof value === 'number' && Math.round(value) !== this.volume) {
          this.volume = Math.round(value)
          this.bump()
        }
        return
    }
  }

  private onEvent(event: MpvEvent): void {
    switch (event.event) {
      case 'log-message': {
        // yt-dlp 的报错（如 YouTube 机器人验证）只在日志里，end-file 只说“加载失败”
        if (event['level'] === 'error' && typeof event['text'] === 'string') {
          // yt-dlp 自己的 `ERROR: ...` 最具体，后面 ytdl_hook 的“unexpected error”不覆盖它
          const text = event['text'].trim().replace(/^\[ytdl_hook\]\s*/, '')
          if (text.startsWith('ERROR:') || (text && this.lastLoadError === undefined)) this.lastLoadError = text
        }
        return
      }
      case 'file-loaded': {
        this.status = 'playing'
        this.error = null
        this.consecutiveErrors = 0
        this.bump()
        return
      }
      case 'end-file': {
        if (event['playlist_entry_id'] !== this.entryId) return
        if (event['reason'] === 'eof') {
          this.schedule(() => this.advance(true)).catch(() => undefined)
          return
        }
        if (event['reason'] === 'error') {
          const detail = this.lastLoadError ?? (typeof event['file_error'] === 'string' ? event['file_error'] : '未知错误')
          const track = this.queue[this.index]
          this.fail(`${track ? `《${track.title}》` : ''}加载失败：${detail}`)
          if (this.consecutiveErrors < MAX_CONSECUTIVE_ERRORS && this.index + 1 < this.queue.length) {
            setTimeout(() => this.schedule(() => this.advance(false)).catch(() => undefined), 500)
          }
        }
        return
      }
    }
  }
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(length - 1, Math.trunc(index)))
}
