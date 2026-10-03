// 标题清理：B 站等网站的视频标题里夹着很多标签，显示和搜歌词前先去掉。

/** 成对的标签括号：【4K修复】、〖Hi-Res〗、[MV]、「歌词版」 */
const TAG_PATTERN = /【[^】]*】|〖[^〗]*〗|\[[^\]]*\]|「[^」]*」|『[^』]*』/g

/** 搜歌词时要去掉的修饰词 */
const NOISE_PATTERN =
  /官方|高清|无损|音质|歌词版|动态歌词|完整版|中英字幕|中英|字幕|修复版?|MV|4K|Hi-?Res|HD|1080P|Official (Music )?Video|Lyrics? Video|Lyrics?/gi

const EDGE_SEPARATORS = /^[\s|｜\-—_/·:：,，.。]+|[\s|｜\-—_/·:：,，.。]+$/g

/** 去掉标签括号段和首尾分隔符；什么都不剩时返回原文。 */
export function stripTags(title: string): string {
  const stripped = title.replace(TAG_PATTERN, ' ').replace(/\s+/g, ' ').replace(EDGE_SEPARATORS, '')
  return stripped || title.trim()
}

/**
 * 为搜歌词准备几个由准到宽的关键词。
 * 有《书名号》时它多半是歌名，配上剩下的第一段（多半是歌手）；再退到去掉修饰词的整个标题。
 */
export function lyricsQueries(title: string, artists: string[], trustArtists: boolean): string[] {
  const stripped = stripTags(title)
  const queries: string[] = []
  const quoted = /《([^》]+)》/.exec(stripped)?.[1]?.trim()
  if (quoted) {
    const rest = stripped.replace(/《[^》]+》/, ' ').replace(TAG_PATTERN, ' ')
    const other = rest.split(/[-—|｜/]/).map(part => part.replace(NOISE_PATTERN, '').replace(/['"‘’“”]/g, '').trim()).find(Boolean)
    if (other) queries.push(`${quoted} ${other}`)
    queries.push(quoted)
  }
  const plain = stripped.replace(NOISE_PATTERN, ' ').replace(/[-—|｜/《》'"‘’“”()（）]/g, ' ').replace(/\s+/g, ' ').trim()
  if (trustArtists && artists[0]) queries.push(`${plain} ${artists[0]}`)
  if (plain) queries.push(plain)
  return [...new Set(queries)]
}
