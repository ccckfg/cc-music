import { describe, expect, test } from 'claude-code/testing'

import { fakeDaemon, FULLSCREEN, music, PANE, RICE, SESSION, SUNNY } from './fake-daemon.ts'

describe('侧边栏', () => {
  test('全屏布局下 /music 停靠成侧边栏；搜歌播放也会打开它，主屏幕布局下不会', async ($, on) => {
    const fake = fakeDaemon(on)
    await $.session.start(SESSION)

    await $.command.run(music('晴天'))
    expect(fake.opened).toEqual([])

    await $.command.run(music('晴天', FULLSCREEN))
    expect(fake.opened.map(o => o.id)).toEqual(['cc-music'])
    await $.command.run(music('next', FULLSCREEN))
    expect(fake.opened).toHaveLength(1)

    expect((await $.command.run(music('', FULLSCREEN))).text).toContain('已在右侧打开 cc-music 侧边栏')
    expect((await $.command.run(music('', { isFullscreen: true, columns: 100 }))).text).toContain('拉宽到 110 列以上')
  })

  test('侧边栏竖着排：封面在上、进度条单独一行、歌词占满剩下的高度', async ($, on) => {
    const fake = fakeDaemon(on)
    await $.session.start(SESSION)
    await $.command.run(music('晴天', FULLSCREEN))
    await fake.clock.advance(1000)

    const pane = await $.ui.mount({
      ...PANE,
      surface: 'terminal',
      props: { ...PANE.props, bodyColumns: 46, placement: 'dock' },
      viewport: { columns: 160, rows: 40, isFullscreen: true },
    })
    expect(await pane.find({ type: 'Raster' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '0:12 / 4:30' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '从出生那年就飘着' })).toBeDefined()
    await pane.unmount()
  })
})

describe('cc-music 面板', () => {
  test('/music 打开面板；正在播放页有曲目、当前歌词行，终端上还有封面', async ($, on) => {
    const fake = fakeDaemon(on)
    await $.session.start(SESSION)

    expect((await $.command.run(music(''))).text).toContain('已在输入框上方打开面板')
    expect(fake.opened).toEqual([{ id: 'cc-music', columns: 48 }])

    // 假 daemon 播到第 12 秒；轮询一次去取歌词和封面
    await $.command.run(music('晴天'))
    await fake.clock.advance(1000)

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ ...PANE, surface })
      expect(await pane.find({ type: 'Text', text: '晴天' })).toBeDefined()
      expect((await pane.find({ type: 'Text', text: '故事的小黄花' }))?.props['bold']).toBe(true)
      expect((await pane.find({ type: 'Text', text: '从出生那年就飘着' }))?.props['bold']).toBeUndefined()
      const raster = await pane.find({ type: 'Raster' })
      if (surface === 'terminal') expect(raster?.props['columns']).toBe(2)
      else expect(raster).toBeUndefined()

      await pane.press({ key: 'toggle' })
      expect(fake.commands.at(-1)).toEqual({ type: 'toggle' })
      await pane.press({ key: 'toggle' })
      await pane.unmount()
    }
  })

  test('搜索页：回车搜索，结果可以立即播放或加入队列', async ($, on) => {
    const fake = fakeDaemon(on)
    await $.session.start(SESSION)
    await $.command.run(music(''))

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'tab-search' })
    await pane.input({ key: 'query', text: 'bili:稻香' })
    expect(fake.searches).toEqual(['bilibili|稻香'])
    expect(await pane.find({ type: 'Text', text: /2\. 稻香 — 周杰伦/ })).toBeDefined()

    await pane.press({ key: 'result-1-play' })
    expect(fake.commands.at(-1)).toEqual({ type: 'enqueue', tracks: [RICE], next: true, play: true })
    await pane.press({ key: 'result-0-add' })
    expect(fake.commands.at(-1)).toEqual({ type: 'enqueue', tracks: [SUNNY] })
    expect(fake.toasts.at(-1)).toContain('已加入队列')
    await pane.unmount()
  })

  test('收藏：按 f 收藏当前歌曲，收藏页列出并能取消', async ($, on) => {
    const fake = fakeDaemon(on)
    await $.session.start(SESSION)
    await $.command.run(music('晴天'))
    await $.command.run(music(''))

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'favorite' })
    expect(fake.library.favorites).toEqual([SUNNY])
    expect(await pane.find({ key: 'favorite', text: '已收藏' })).toBeDefined()

    await pane.press({ key: 'tab-favorites' })
    expect(await pane.find({ type: 'Text', text: /1\. 晴天 — 周杰伦/ })).toBeDefined()
    await pane.press({ key: 'fav-0-unfav' })
    expect(fake.library.favorites).toEqual([])
    expect(await pane.find({ type: 'Text', text: /还没有收藏/ })).toBeDefined()
    await pane.unmount()
  })

  test('队列页：当前曲目有标记，可以跳转和移除', async ($, on) => {
    const fake = fakeDaemon(on)
    await $.session.start(SESSION)
    await $.command.run(music('晴天'))
    await $.command.run(music('add 2'))
    await $.command.run(music(''))

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'tab-queue' })
    expect(await pane.find({ type: 'Text', text: /共 2 首/ })).toBeDefined()
    await pane.press({ key: 'queue-1-jump' })
    expect(fake.commands.at(-1)).toEqual({ type: 'jump', index: 1 })
    await pane.press({ key: 'queue-0-remove' })
    expect(fake.commands.at(-1)).toEqual({ type: 'remove', index: 0 })
    await pane.unmount()
  })

  test('旧版 daemon：面板提示 /music restart，/music lyrics 说明原因', async ($, on) => {
    const fake = fakeDaemon(on, '0.1.0')
    await $.session.start(SESSION)
    await $.command.run(music('晴天'))
    await $.command.run(music(''))
    await fake.clock.advance(1000)

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pane.find({ type: 'Text', text: /旧版本（0\.1\.0）/ })).toBeDefined()
    await pane.unmount()
    expect((await $.command.run(music('lyrics'))).text).toContain('/music restart')
  })
})

test('/music lyrics 和模型的 lyrics 动作给出当前歌曲的歌词', async ($, on) => {
  fakeDaemon(on)
  await $.session.start(SESSION)
  await $.command.run(music('晴天'))

  expect((await $.command.run(music('lyrics'))).text).toContain('故事的小黄花')
  const called = await $.tool.call({ tool: 'mcp__cc-music__music', action: 'lyrics' })
  expect(String(called.result)).toContain('从出生那年就飘着')
})
