import { expect, test } from 'claude-code/testing'

import { BAND, fakeDaemon, FULLSCREEN, music, openTab, PANE, SESSION } from './fake-daemon.ts'

test('从「设置」进入：读出 daemon 的配置，改默认音源、启动音量和空闲退出', async ($, on) => {
  const fake = fakeDaemon(on)
  await $.session.start(SESSION)
  await $.command.run(music(''))

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openTab(pane, 'settings')
  // 选中的项是橙色的 ● 文字，没选中的是 ○ 按钮；空闲退出是 ‹ 30 分钟 ›
  expect(await pane.find({ type: 'Text', text: '● 哔哩哔哩' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '30 分钟' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'C:/Users/me/.cc-music/config.json' })).toBeDefined()

  await pane.press({ key: 'provider-ytmusic' })
  await pane.press({ key: 'startup-vol-down' })
  await pane.press({ key: 'idle-next' })
  await pane.press({ key: 'idle-next' })
  expect(fake.configPatches).toEqual([{ defaultProvider: 'ytmusic' }, { volume: 50 }, { idleExitMinutes: 60 }, { idleExitMinutes: 0 }])
  expect(await pane.find({ type: 'Text', text: '● YouTube Music' })).toBeDefined()
  expect(await pane.find({ key: 'provider-bilibili' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '不退出' })).toBeDefined()
  // 从“不退出”往后转一圈回到 10 分钟
  await pane.press({ key: 'idle-next' })
  expect(fake.configPatches.at(-1)).toEqual({ idleExitMinutes: 10 })

  await openTab(pane, 'now')
  expect(await pane.find({ type: 'Text', text: /还没有在播放/ })).toBeDefined()
  await pane.unmount()
})

test('YouTube 的 cookies：填路径回车保存，提示文件在不在', async ($, on) => {
  const fake = fakeDaemon(on)
  await $.session.start(SESSION)
  await $.command.run(music(''))

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openTab(pane, 'settings')
  expect(await pane.find({ type: 'Text', text: /没有配置/ })).toBeDefined()

  await pane.input({ key: 'cookies', text: 'C:/Users/me/missing.txt' })
  expect(fake.configPatches.at(-1)).toEqual({ cookiesFile: 'C:/Users/me/missing.txt' })
  expect(await pane.find({ type: 'Text', text: /找不到这个文件/ })).toBeDefined()

  await pane.input({ key: 'cookies', text: 'C:/Users/me/.cc-music/cookies.txt' })
  expect(await pane.find({ type: 'Text', text: '✓ 已配置' })).toBeDefined()
  await pane.unmount()
})

test('界面偏好：关掉迷你播放器、放歌时打开侧边栏和封面，立即生效并存进 $.store', async ($, on) => {
  const fake = fakeDaemon(on)
  await $.session.start(SESSION)
  await $.command.run(music('晴天'))
  await $.command.run(music(''))
  await fake.clock.advance(1000)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Raster' })).toBeDefined()
  await openTab(pane, 'settings')
  await pane.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'switch-mini-player' })
  await pane.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'switch-auto-sidebar' })
  await pane.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'switch-cover' })
  expect(fake.store.get('prefs')).toEqual({ showMiniPlayer: false, autoOpenSidebar: false, showCover: false })
  await openTab(pane, 'now')
  expect(await pane.find({ type: 'Raster' })).toBeUndefined()
  await pane.unmount()

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ text: /晴天/ })).toBeUndefined()
  await band.unmount()

  const opened = fake.opened.length
  await $.command.run(music('稻香', FULLSCREEN))
  expect(fake.opened).toHaveLength(opened)
})

test('上次会话存下的偏好在新会话里生效；/music show 恢复迷你播放器并存下', async ($, on) => {
  const fake = fakeDaemon(on, { store: { prefs: { showMiniPlayer: false, showCover: 'yes' } } })
  await $.session.start(SESSION)
  await $.command.run(music('晴天'))

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ text: /晴天/ })).toBeUndefined()
  await $.command.run(music('show'))
  expect(await band.find({ type: 'Text', text: '晴天' })).toBeDefined()
  // 类型不对的项（showCover: 'yes'）用默认值
  expect(fake.store.get('prefs')).toEqual({ showMiniPlayer: true, autoOpenSidebar: true, showCover: true })
  await band.unmount()
})

test('保存失败：设置页显示原因，原来的值不变', async ($, on) => {
  fakeDaemon(on, { configError: '写不了 config.json' })
  await $.session.start(SESSION)
  await $.command.run(music(''))

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openTab(pane, 'settings')
  await pane.press({ key: 'idle-prev' })
  expect(await pane.find({ type: 'Text', text: /写不了 config\.json/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '30 分钟' })).toBeDefined()
  await pane.unmount()
})
