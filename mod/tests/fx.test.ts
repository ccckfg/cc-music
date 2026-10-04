import { expect, test } from 'claude-code/testing'

import { BAND, fakeDaemon, music, PANE, SESSION } from './fake-daemon.ts'

/** 30 列宽、40 行高的侧边栏 */
const DOCK = {
  ...PANE,
  surface: 'terminal',
  props: { ...PANE.props, bodyColumns: 30, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } },
} as const

test('播放时：进度在两次轮询之间往前走，状态字像 Claude Code 思考时那样转圈、流光；暂停后停住', async ($, on) => {
  fakeDaemon(on)
  await $.session.start(SESSION)
  await $.command.run(music('晴天'))
  const pane = await $.ui.mount(DOCK)

  expect(await pane.find({ type: 'Text', text: '0:12', in: 'progress' })).toBeDefined()
  expect(await pane.find({ text: /播放中…/, in: 'progress' })).toBeDefined()
  const first = JSON.stringify(await pane.drawn({ in: 'progress' }))
  await pane.advance(100)
  // 转圈换了一帧、流光挪了一格
  expect(JSON.stringify(await pane.drawn({ in: 'progress' }))).not.toBe(first)
  await pane.advance(900)
  expect(await pane.find({ type: 'Text', text: '0:13', in: 'progress' })).toBeDefined()

  await pane.press({ key: 'toggle' })
  expect(await pane.find({ text: /▮▮ 已暂停/, in: 'progress' })).toBeDefined()
  const paused = JSON.stringify(await pane.drawn({ in: 'progress' }))
  await pane.advance(2000)
  expect(JSON.stringify(await pane.drawn({ in: 'progress' }))).toBe(paused)
  await pane.unmount()
})

test('频谱：播放时一直在跳，暂停后落成一条线不再动', async ($, on) => {
  fakeDaemon(on)
  await $.session.start(SESSION)
  await $.command.run(music('晴天'))
  const pane = await $.ui.mount(DOCK)

  const frames = new Set<string>()
  for (let i = 0; i < 5; i += 1) {
    await pane.advance(90)
    frames.add(JSON.stringify(await pane.drawn({ in: 'viz' })))
  }
  expect(frames.size).toBeGreaterThan(3)

  await pane.press({ key: 'toggle' })
  await pane.advance(3000)
  const settled = JSON.stringify(await pane.drawn({ in: 'viz' }))
  await pane.advance(500)
  expect(JSON.stringify(await pane.drawn({ in: 'viz' }))).toBe(settled)
  expect(settled).toContain('▁')
  await pane.unmount()
})

test('换标签时下面的橙线滑过去', async ($, on) => {
  fakeDaemon(on)
  await $.session.start(SESSION)
  await $.command.run(music(''))
  const pane = await $.ui.mount(DOCK)
  const segments = async () => {
    // 画出来的树是普通数据：一个 Box，里面每段同色的线是一个 Text
    const line = JSON.parse(JSON.stringify(await pane.drawn({ in: 'tabline' }))) as { children?: { children?: string[] }[] }
    return (line.children ?? []).map(child => child.children?.[0] ?? '')
  }
  // 28 格宽：五个标签各 4 格，间隔 2 格；「当前」在 0–3 格
  expect(await segments()).toEqual(['━━━━', '─'.repeat(24)])

  await pane.press({ key: 'tab-search' })
  await pane.advance(60)
  const halfway = await segments()
  expect(halfway[0]).not.toBe('━━━━')
  expect(halfway[0]?.startsWith('─')).toBe(true)

  await pane.advance(300)
  expect(await segments()).toEqual(['──────', '━━━━', '─'.repeat(18)])
  await pane.unmount()
})

test('均衡器图标：迷你播放器开头、队列里的当前曲目都在跳', async ($, on) => {
  fakeDaemon(on)
  await $.session.start(SESSION)
  await $.command.run(music('晴天'))

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const first = JSON.stringify(await band.drawn({ in: 'band-eq' }))
  await band.advance(450)
  expect(JSON.stringify(await band.drawn({ in: 'band-eq' }))).not.toBe(first)
  await band.unmount()

  await $.command.run(music(''))
  const pane = await $.ui.mount(DOCK)
  await pane.press({ key: 'tab-queue' })
  expect(await pane.find({ in: 'queue-0-eq' })).toBeDefined()
  await pane.unmount()
})

test('空状态画像素图标：没在播放是一张黑胶唱片，收藏、历史各有图标', async ($, on) => {
  fakeDaemon(on)
  await $.session.start(SESSION)
  await $.command.run(music(''))
  const pane = await $.ui.mount(DOCK)
  expect(await pane.find({ type: 'Raster', key: 'icon-vinyl' })).toBeDefined()
  await pane.press({ key: 'tab-favorites' })
  expect(await pane.find({ type: 'Raster', key: 'icon-heart' })).toBeDefined()
  await pane.press({ key: 'tab-history' })
  expect(await pane.find({ type: 'Raster', key: 'icon-clock' })).toBeDefined()
  await pane.unmount()
})
