// 动效模块（Client 的 surface module）共用的小工具：每个实例自己的帧时钟、
// 两次轮询之间推算播放位置、Claude Code 思考时那样的转圈和流光、确定性的“随机数”。
import type { ClientSurface } from 'claude-code'

/** Claude Code 思考时的转圈字形（非 macOS 的那一套），来回播放 */
const SPINNER = ['·', '✢', '*', '✶', '✻', '✽']

export function spinnerFrame(tick: number): string {
  const cycle = SPINNER.length * 2 - 2
  const i = tick % cycle
  return SPINNER[i < SPINNER.length ? i : cycle - i] ?? '·'
}

/**
 * 流光：一段亮光从左往右扫过一段文字，扫完隔几帧再来。
 * 返回第 index 个字离光带中心有多远（0 最亮）。
 */
export function glimmer(index: number, length: number, tick: number): number {
  const span = length + 8
  const center = (tick % span) - 3
  return Math.abs(index - center)
}

/** 每个 Client 实例自己的可变数据。surface 对象在实例的一生里不变，用它当键 */
const instances = new WeakMap<object, object>()

export function instanceOf<T extends object>(surface: object, init: () => T): T {
  let found = instances.get(surface) as T | undefined
  if (!found) {
    found = init()
    instances.set(surface, found)
  }
  return found
}

/**
 * 启动实例的帧时钟（只在第一次画时启动）。每帧 tick 加一，onTick 返回 true 时重画。
 * onTick 要读最新的 props：存在实例数据里，别用第一次画时闭包里的那份。
 */
export function startFrames(surface: ClientSurface<number>, ms: number, frames: { tick: number }, onTick: () => boolean): void {
  if (surface.state !== undefined) return
  surface.every(ms, () => {
    frames.tick += 1
    if (onTick()) surface.setState(frames.tick)
  })
  surface.setState(0)
}

/** 推算出来的播放位置：从 props 里最近一次的位置开始，按帧往前走 */
export type Playhead = { tick: number; head?: { position: number; tick: number; key: string } }

/**
 * props 每秒才更新一次位置；中间按帧往前推，进度条和卡拉 OK 才走得顺。
 * 最多往前推 1.5 秒：轮询断了也不会一直跑下去。
 */
export function playhead(state: Playhead, position: number, isPlaying: boolean, duration: number | null, msPerTick: number): number {
  const key = `${position}|${isPlaying}`
  if (!state.head || state.head.key !== key) state.head = { position, tick: state.tick, key }
  if (!isPlaying) return position
  const elapsed = ((state.tick - state.head.tick) * msPerTick) / 1000
  const ahead = state.head.position + Math.min(elapsed, 1.5)
  return duration && duration > 0 ? Math.min(ahead, duration) : ahead
}

/** 确定性的伪随机数 [0, 1)：同样的参数得到同样的值，动画可重现、可测试 */
export function noise(a: number, b: number, c = 0): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** 字符串 → 整数种子（每首歌的频谱样子不一样） */
export function seedOf(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** 把一串 [字, 颜色] 合并成同色的段，少画几个 Text */
export function runs(cells: [string, string | undefined][]): { text: string; color: string | undefined }[] {
  const out: { text: string; color: string | undefined }[] = []
  for (const [char, color] of cells) {
    const last = out[out.length - 1]
    if (last && last.color === color) last.text += char
    else out.push({ text: char, color })
  }
  return out
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** 动效区域发给 hooks 的消息（surface.post → ui.message） */
export type FxMessage =
  | { action: 'tab'; tab: string }
  | { action: 'prev' | 'toggle' | 'next' | 'repeat' | 'favorite' | 'restart' }
  | { action: 'seek'; seconds: number }
  | { action: 'volume'; value: number }
  | { action: 'pref'; name: string; value: boolean }

/** 一排可点的东西：每项的起止列；x 落在哪项上 */
export type Span = { start: number; end: number }

export function hit<T extends Span>(spans: T[], x: number): T | undefined {
  return spans.find(span => x >= span.start && x < span.end)
}

/** 渐变：t ∈ [0, 1] 落在色带的哪一档 */
export function rampAt(ramp: string[], t: number): string | undefined {
  if (ramp.length === 0) return undefined
  return ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(clamp01(t) * ramp.length)))]
}
