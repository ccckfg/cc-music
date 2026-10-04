import { expect, test } from 'claude-code/testing'

import { decodeEntities, titleParts } from '../hooks/format.ts'
import type { Track } from '../types'

const bili = (title: string): Track => ({ provider: 'bilibili', id: 'BV1', title, artists: ['UP'], pageUrl: '' })

test('B 站标题：《书名号》里是歌名，其余放进副标题，分隔符理顺成 ·', () => {
  expect(titleParts(bili('Taylor Swift & Bon Iver《exile》超高清现场，听一次哭一次'))).toEqual({
    title: 'exile',
    detail: 'Taylor Swift & Bon Iver · 超高清现场，听一次哭一次',
  })
  expect(titleParts(bili('日推循环|《感官过载》- 残像音阶、M3mo'))).toEqual({ title: '感官过载', detail: '日推循环 · 残像音阶、M3mo' })
  expect(titleParts(bili('【中字MV】Taylor Swift - Babylon (Official Lyric Video)'))).toEqual({ title: 'Taylor Swift · Babylon', detail: '中字MV' })
  // 词里的连字符不动
  expect(titleParts(bili('Jay-Z - 99 Problems')).title).toBe('Jay-Z · 99 Problems')
  expect(titleParts(bili('晴天'))).toEqual({ title: '晴天', detail: '' })
})

test('HTML 实体：B 站转义两遍的也解开；YouTube Music 的标题原样', () => {
  expect(decodeEntities('I Look in People&amp;#x27;s Windows')).toBe("I Look in People's Windows")
  expect(decodeEntities('R&amp;B &lt;3 &#39;x&#39;')).toBe("R&B <3 'x'")
  expect(decodeEntities('&unknown; 50%')).toBe('&unknown; 50%')
  expect(titleParts(bili('I Look in People&amp;#x27;s Windows')).title).toBe("I Look in People's Windows")
  expect(titleParts({ provider: 'ytmusic', id: 'x', title: 'exile (feat. Bon Iver)', artists: ['Taylor Swift'], pageUrl: '' })).toEqual({
    title: 'exile (feat. Bon Iver)',
    detail: '',
  })
})
