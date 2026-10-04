import { expect, test } from 'claude-code/testing'

import { BAND, control, fakeDaemon, music, openTab, PANE, SESSION } from './fake-daemon.ts'

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

  await control(pane, 'toggle')
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

  await control(pane, 'toggle')
  await pane.advance(3000)
  const settled = JSON.stringify(await pane.drawn({ in: 'viz' }))
  await pane.advance(500)
  expect(JSON.stringify(await pane.drawn({ in: 'viz' }))).toBe(settled)
  expect(settled).toContain('▁')
  await pane.unmount()
})

test('标签栏：当前标签是橙色胶囊，点图标就切换，下面的橙线滑过去', async ($, on) => {
  fakeDaemon(on)
  await $.session.start(SESSION)
  await $.command.run(music(''))
  const pane = await $.ui.mount(DOCK)
  // 画出来的树是普通数据：第二行是下划线，每段同色的线是一个 Text
  const underline = async () => {
    const tabs = JSON.parse(JSON.stringify(await pane.drawn({ in: 'tabs' }))) as { children?: { children?: { children?: string[] }[] }[] }
    return (tabs.children?.[1]?.children ?? []).map(run => run.children?.[0] ?? '')
  }
  // 28 格放不下所有文字：当前标签“ ♫ 当前 ”带字（8 格），其余只有图标（3 格），⚙ 贴右边
  expect((await pane.find({ type: 'Text', text: /♫ 当前/, in: 'tabs' }))?.props['inverse']).toBe(true)
  expect(await pane.find({ type: 'Text', text: /⚙/, in: 'tabs' })).toBeDefined()
  expect(await underline()).toEqual(['━━━━━━━━', '─'.repeat(20)])

  // “ ♫ 当前 ”占 0–7 格，“ ⌕ ”在 8–10 格：点第 9 格
  await pane.pointer({ type: 'down', x: 9, y: 0, button: 'left', in: 'tabs' })
  expect((await pane.find({ type: 'Text', text: /⌕ 搜索/, in: 'tabs' }))?.props['inverse']).toBe(true)
  await pane.advance(60)
  const halfway = await underline()
  expect(halfway[0]?.startsWith('─')).toBe(true)
  expect(halfway).not.toEqual(['───', '━━━━━━━━', '─'.repeat(17)])
  await pane.advance(300)
  expect(await underline()).toEqual(['───', '━━━━━━━━', '─'.repeat(17)])

  // 最右边的 ⚙ 打开设置
  await pane.pointer({ type: 'down', x: 26, y: 0, button: 'left', in: 'tabs' })
  expect(await pane.find({ type: 'Text', text: /⚙ 设置/, in: 'tabs' })).toBeDefined()
  await pane.unmount()
})

test('播放控制：点胶囊暂停、点 ↻ 换循环模式；点进度条跳转，鼠标停在上面时显示会跳到哪；点音量条调音量', async ($, on) => {
  const fake = fakeDaemon(on)
  await $.session.start(SESSION)
  await $.command.run(music('晴天'))
  const pane = await $.ui.mount(DOCK)

  // 28 格宽：↻ ◀◀ [ ▮▮ ] ▶▶ ♥，间隔 3 格，居中
  expect((await pane.find({ type: 'Text', text: /^\s*▮▮\s*$/, in: 'transport' }))?.props['inverse']).toBe(true)
  await pane.pointer({ type: 'down', x: 13, y: 0, button: 'left', in: 'transport' })
  expect(fake.commands.at(-1)).toEqual({ type: 'toggle' })
  expect(await pane.find({ type: 'Text', text: /^\s*▶\s*$/, in: 'transport' })).toBeDefined()
  await control(pane, 'repeat')
  expect(fake.commands.at(-1)).toEqual({ type: 'repeat', mode: 'all' })

  // 进度条 28 格对应 0–270 秒：点第 14 格 ≈ 140 秒
  await pane.pointer({ type: 'move', x: 14, y: 0, in: 'progress' })
  expect(await pane.find({ text: /▸ 2:20/, in: 'progress' })).toBeDefined()
  await pane.pointer({ type: 'down', x: 14, y: 0, button: 'left', in: 'progress' })
  expect(fake.commands.at(-1)).toEqual({ type: 'seek', seconds: 140 })
  await pane.pointer({ type: 'leave', x: 14, y: 0, in: 'progress' })
  expect(await pane.find({ text: /▸ 2:20/, in: 'progress' })).toBeUndefined()

  // 音量条：“音量 ”后面 16 根竖条，点第 8 根（x = 5 + 7）→ 50
  await pane.pointer({ type: 'down', x: 12, y: 0, button: 'left', in: 'volume' })
  expect(fake.commands.at(-1)).toEqual({ type: 'volume', value: 50 })
  await pane.unmount()
})

test('标题旁的音符：播放时轮流往上跳，暂停后都落下来', async ($, on) => {
  fakeDaemon(on)
  await $.session.start(SESSION)
  await $.command.run(music('晴天'))
  const pane = await $.ui.mount(DOCK)
  const rows = async () => {
    const notes = JSON.parse(JSON.stringify(await pane.drawn({ in: 'notes' }))) as { children?: { children?: { children?: string[] }[] }[] }
    return (notes.children ?? []).map(row => (row.children ?? []).map(cell => cell.children?.[0] ?? '').join(''))
  }
  // 每一帧上面一行恰好有一个音符，三个音符轮流往上跳
  const jumpers = new Set<number>()
  for (let i = 0; i < 6; i += 1) {
    const [top = ''] = await rows()
    expect(top.replace(/ /g, '')).toHaveLength(1)
    jumpers.add(top.search(/\S/))
    await pane.advance(170)
  }
  expect(jumpers.size).toBe(3)

  await control(pane, 'toggle')
  const [top = '', bottom = ''] = await rows()
  expect(top.trim()).toBe('')
  expect(bottom.replace(/ /g, '')).toHaveLength(3)
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
  await openTab(pane, 'queue')
  expect(await pane.find({ in: 'queue-0-eq' })).toBeDefined()
  await pane.unmount()
})

test('空状态画像素图标：没在播放是一张黑胶唱片，收藏、历史各有图标', async ($, on) => {
  fakeDaemon(on)
  await $.session.start(SESSION)
  await $.command.run(music(''))
  const pane = await $.ui.mount(DOCK)
  expect(await pane.find({ type: 'Raster', key: 'icon-vinyl' })).toBeDefined()
  await openTab(pane, 'favorites')
  expect(await pane.find({ type: 'Raster', key: 'icon-heart' })).toBeDefined()
  await openTab(pane, 'history')
  expect(await pane.find({ type: 'Raster', key: 'icon-clock' })).toBeDefined()
  await pane.unmount()
})
