import { describe, expect, test } from 'claude-code/testing'

import { BAND, fakeDaemon, music, RICE, SESSION, SUNNY } from './fake-daemon.ts'

describe('/music 命令', () => {
  test('搜索并立即播放第一个结果，结果列表留给序号使用', async ($, on) => {
    const { commands, searches } = fakeDaemon(on)
    await $.session.start(SESSION)

    const { text } = await $.command.run(music('晴天'))
    expect(text).toContain('正在加载：晴天 — 周杰伦')
    expect(text).toContain(' 2. 稻香')
    expect(searches).toEqual(['|晴天'])
    expect(commands).toEqual([{ type: 'enqueue', tracks: [SUNNY], next: true, play: true }])

    await $.command.run(music('2'))
    expect(commands.at(-1)).toEqual({ type: 'enqueue', tracks: [RICE], next: true, play: true })
  })

  test('音源前缀只认 daemon 报告的音源', async ($, on) => {
    const { searches } = fakeDaemon(on)
    await $.session.start(SESSION)

    await $.command.run(music('search bili:晴天'))
    await $.command.run(music('search Re:Zero'))
    expect(searches).toEqual(['bilibili|晴天', '|Re:Zero'])
  })

  test('控制命令和参数校验', async ($, on) => {
    const { commands } = fakeDaemon(on)
    await $.session.start(SESSION)

    expect((await $.command.run(music('vol +10'))).text).toBe('音量 70')
    await $.command.run(music('seek 1:30'))
    await $.command.run(music('repeat 单曲'))
    expect(commands).toEqual([
      { type: 'volume', delta: 10 },
      { type: 'seek', seconds: 90, relative: false },
      { type: 'repeat', mode: 'one' },
    ])
    expect((await $.command.run(music('vol 很大'))).text).toContain('音量写成')
    expect((await $.command.run(music('3'))).text).toContain('还没有搜索过')
  })
})

test('模型的 music 工具：queue 把最匹配的一首加到队尾', async ($, on) => {
  const { commands } = fakeDaemon(on)
  await $.session.start(SESSION)

  const called = await $.tool.call({ tool: 'mcp__cc-music__music', action: 'queue', query: '稻香 周杰伦' })
  expect(called.deny).toBeUndefined()
  expect(String(called.result)).toContain('已加入队列')
  expect(commands).toEqual([{ type: 'enqueue', tracks: [SUNNY] }])
})

test('迷你播放器：播放时显示曲目，按钮能暂停；空闲时不显示', async ($, on) => {
  fakeDaemon(on)
  await $.session.start(SESSION)

  for (const surface of ['terminal', 'desktop'] as const) {
    const idle = await $.ui.mount({ ...BAND, surface })
    expect(await idle.find({ text: /晴天/ })).toBeUndefined()
    await idle.unmount()
  }

  await $.command.run(music('晴天'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Text', text: '晴天' })).toBeDefined()
    expect(await band.find({ key: 'toggle', text: '❚❚' })).toBeDefined()
    await band.press({ key: 'toggle' })
    expect(await band.find({ key: 'toggle', text: '▶' })).toBeDefined()
    await band.press({ key: 'toggle' })
    await band.unmount()
  }
})

test('迷你播放器和下面插件画的状态条叠在一起，不把它盖掉', async ($, on) => {
  fakeDaemon(on, { bandBelow: 'crush 状态条' })
  await $.session.start(SESSION)

  // 没在播放时只有下面那一行
  const idle = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await idle.find({ type: 'Text', text: 'crush 状态条' })).toBeDefined()
  await idle.unmount()

  await $.command.run(music('晴天'))
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: '晴天' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'crush 状态条' })).toBeDefined()
  await band.unmount()
})
