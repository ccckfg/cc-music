// cc-music 面板的画法：纯函数，拿元素表、数据和动作，返回树；不碰 `$`。
// 颜色全用 Claude Code 的主题色名（见 theme.ts），跟着用户的主题走。
import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  InputProps,
  RasterProps,
  RenderElement,
  TextProps,
} from 'claude-code'

import type {
  CoverResponse,
  LastSearch,
  LibraryResponse,
  LyricsState,
  PaneTab,
  PlayerCommand,
  PlayerSnapshot,
  SearchState,
  Track,
} from '../types'
import { coverCells } from './cover.ts'
import { currentLyricIndex, formatTime, timeAgo, trackKey } from './format.ts'
import { C, cellWidth, truncate, wrapText } from './theme.ts'

/** 画面板用到的元素；Input、Raster 不是每个界面都有。 */
export type Kit = {
  Box: ElementConstructor<BoxProps>;
  Text: ElementConstructor<TextProps>;
  Button: ElementConstructor<ButtonProps>;
  Input?: ElementConstructor<InputProps>;
  Raster?: ElementConstructor<RasterProps>;
}

export type PaneModel = {
  /** 面板内容区的宽度（格） */
  columns: number;
  tab: PaneTab;
  player: PlayerSnapshot | null;
  lyrics: LyricsState | null;
  cover: CoverResponse | null;
  library: LibraryResponse | null;
  lastSearch: LastSearch | null;
  search: SearchState;
  /** 停靠在对话旁边成了侧边栏（全屏布局），这时竖着排、歌词占满剩下的高度 */
  isDocked: boolean;
  /** 终端的行数；侧边栏从上到下占满它 */
  rows: number;
  /** daemon 是旧版本时它的版本号，面板提示用户 /music restart */
  outdatedDaemon: string | undefined;
}

export type PaneActions = {
  command: (cmd: PlayerCommand) => void;
  setTab: (tab: PaneTab) => void;
  search: (query: string) => void;
  play: (track: Track) => void;
  enqueue: (track: Track) => void;
  toggleFavorite: (track: Track) => void;
}

const TABS: { id: PaneTab; label: string }[] = [
  { id: 'now', label: '当前' },
  { id: 'search', label: '搜索' },
  { id: 'queue', label: '队列' },
  { id: 'favorites', label: '收藏' },
  { id: 'history', label: '历史' },
]
const TAB_GAP = 2

const STATUS: Record<PlayerSnapshot['status'], { text: string; color: string }> = {
  idle: { text: '已停止', color: C.dim },
  loading: { text: '加载中', color: C.info },
  playing: { text: '播放中', color: C.success },
  paused: { text: '已暂停', color: C.warning },
  error: { text: '出错', color: C.error },
}

const REPEAT: Record<PlayerSnapshot['repeat'], { next: PlayerSnapshot['repeat']; label: string }> = {
  off: { next: 'all', label: '循环 关' },
  all: { next: 'one', label: '循环 列表' },
  one: { next: 'off', label: '循环 单曲' },
}

const PROVIDER_NAME: Record<string, string> = { bilibili: '哔哩哔哩', ytmusic: 'YouTube Music' }

/** 列表最多画多少首 */
const MAX_LIST = 50
/** 侧边栏里封面的宽度范围（格，取偶数：高度取一半，正好是正方形） */
const COVER_MIN = 12
const COVER_MAX = 36
/** 侧边栏里除了封面、标题和歌词，其余部分大约占的行数 */
const SIDEBAR_CHROME_ROWS = 19
/** 侧边栏里至少留给歌词的行数 */
const MIN_LYRIC_ROWS = 5
/** 横排（输入框上方）时封面的宽度和歌词行数 */
const INLINE_COVER = 20
const INLINE_LYRIC_ROWS = 5
/** 面板窄于这个宽度就竖着排 */
const MIN_COLUMNS_FOR_ROW = 64

export function PaneView(kit: Kit, model: PaneModel, actions: PaneActions): RenderElement {
  const { Box, Text } = kit
  const width = Math.max(20, model.columns)
  return (
    <Box flexDirection="column" width={width}>
      {Header(kit, model.player)}
      {TabBar(kit, model.tab, width, actions)}
      {model.outdatedDaemon ? (
        <Box marginTop={1}>
          <Text color={C.warning} wrap="wrap">
            后台播放器是旧版本（{model.outdatedDaemon}），歌词、封面和收藏要先运行 /music restart。
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {model.tab === 'now' ? NowTab(kit, model, width, actions) : null}
        {model.tab === 'search' ? SearchTab(kit, model, width, actions) : null}
        {model.tab === 'queue' ? QueueTab(kit, model, width, actions) : null}
        {model.tab === 'favorites' ? FavoritesTab(kit, model, width, actions) : null}
        {model.tab === 'history' ? HistoryTab(kit, model, width, actions) : null}
      </Box>
    </Box>
  )
}

/** 第一行：♪ cc-music，右边是播放状态。 */
function Header(kit: Kit, player: PlayerSnapshot | null): RenderElement {
  const { Box, Text } = kit
  const status = player?.current ? STATUS[player.status] : undefined
  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Text color={C.accent} bold>
        ♪ cc-music
      </Text>
      {status ? (
        <Box flexDirection="row">
          <Text color={status.color}>● </Text>
          <Text color={C.dim}>{status.text}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** 标签行：不带方括号的文字，下面一条线，当前那一段是 Claude 橙的粗线。 */
function TabBar(kit: Kit, active: PaneTab, width: number, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = kit
  const used = TABS.reduce((sum, tab) => sum + cellWidth(tab.label), 0) + TAB_GAP * (TABS.length - 1)
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" columnGap={TAB_GAP}>
        {TABS.map(tab => (
          <Button key={`tab-${tab.id}`} label={tab.label} plain dimColor={tab.id !== active} onPress={() => actions.setTab(tab.id)} />
        ))}
      </Box>
      <Box flexDirection="row">
        {TABS.map((tab, i) => (
          <Box flexDirection="row">
            <Text color={tab.id === active ? C.accent : C.border}>{(tab.id === active ? '━' : '─').repeat(cellWidth(tab.label))}</Text>
            {i < TABS.length - 1 ? <Text color={C.border}>{'─'.repeat(TAB_GAP)}</Text> : null}
          </Box>
        ))}
        <Text color={C.border}>{'─'.repeat(Math.max(0, width - used))}</Text>
      </Box>
    </Box>
  )
}

function NowTab(kit: Kit, model: PaneModel, width: number, actions: PaneActions): RenderElement {
  const { Box, Text } = kit
  const player = model.player
  const track = player?.current
  if (!player || !track) {
    return Empty(kit, '还没有在播放', '到「搜索」找一首，或输入 /music 歌名')
  }

  if (model.isDocked || width < MIN_COLUMNS_FOR_ROW) {
    const coverColumns = even(clamp(Math.min(width - 6, (model.rows - SIDEBAR_CHROME_ROWS - MIN_LYRIC_ROWS) * 2), COVER_MIN, COVER_MAX))
    const cover = CoverArt(kit, model.cover, track, coverColumns)
    const titleLines = wrapText(track.title, width - 2).slice(0, 2)
    const chromeRows = SIDEBAR_CHROME_ROWS + (cover ? coverColumns / 2 + 2 : 0) + titleLines.length
    const lyricRows = model.isDocked ? Math.max(MIN_LYRIC_ROWS, model.rows - chromeRows) : INLINE_LYRIC_ROWS
    return (
      <Box flexDirection="column" width={width}>
        {cover ? (
          <Box flexDirection="column" alignItems="center">
            {cover}
          </Box>
        ) : null}
        {TrackInfo(kit, track, titleLines, 'center')}
        <Box marginTop={1}>{Progress(kit, player, width)}</Box>
        <Box marginTop={1}>{Transport(kit, player, track, model.library, actions, 'center')}</Box>
        {Settings(kit, player, actions, 'center')}
        {ErrorLine(kit, player)}
        <Box marginTop={1}>
          <Text color={C.border}>{'─'.repeat(width)}</Text>
        </Box>
        {Lyrics(kit, model.lyrics, track, player.position, width, lyricRows)}
      </Box>
    )
  }

  // 输入框上方：封面在左，信息和控制在右，歌词在下
  const cover = CoverArt(kit, model.cover, track, INLINE_COVER)
  const infoWidth = width - (cover ? INLINE_COVER + 4 : 0)
  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row" columnGap={2}>
        {cover}
        <Box flexDirection="column" width={infoWidth} justifyContent="center">
          {TrackInfo(kit, track, wrapText(track.title, infoWidth).slice(0, 2), 'flex-start')}
          <Box marginTop={1}>{Progress(kit, player, infoWidth)}</Box>
          <Box marginTop={1}>{Transport(kit, player, track, model.library, actions, 'flex-start')}</Box>
          {Settings(kit, player, actions, 'flex-start')}
          {ErrorLine(kit, player)}
        </Box>
      </Box>
      {Lyrics(kit, model.lyrics, track, player.position, width, INLINE_LYRIC_ROWS)}
    </Box>
  )
}

/** 带圆角边框的封面；没有封面或界面画不了 Raster 时返回 null。 */
function CoverArt(kit: Kit, cover: CoverResponse | null, track: Track, columns: number): RenderElement | null {
  const { Box, Raster } = kit
  if (!Raster || !cover || cover.key !== trackKey(track)) return null
  const rows = columns / 2
  const cells = coverCells(cover, columns, rows)
  if (!cells) return null
  return (
    <Box borderStyle="round" borderColor={C.border} flexShrink={0}>
      <Raster key="cover" columns={columns} rows={rows} cells={cells} />
    </Box>
  )
}

function TrackInfo(kit: Kit, track: Track, titleLines: string[], align: 'center' | 'flex-start'): RenderElement {
  const { Box, Text } = kit
  const artists = track.artists.join(' / ')
  const provider = PROVIDER_NAME[track.provider] ?? track.provider
  // B 站的“歌手”其实是 UP 主
  const byline = track.provider === 'bilibili' && artists ? `UP 主 ${artists}` : artists
  const meta = [track.album, provider].filter(Boolean).join(' · ')
  return (
    <Box flexDirection="column" alignItems={align} marginTop={1}>
      {titleLines.map(line => (
        <Text bold>{line}</Text>
      ))}
      {byline ? (
        <Text color={C.accentSoft} wrap="truncate-end">
          {byline}
        </Text>
      ) : null}
      <Text color={C.dim} wrap="truncate-end">
        {meta}
      </Text>
    </Box>
  )
}

/** 进度：0:27 ━━━━━━●──────── 3:34，已播部分 Claude 橙。 */
function Progress(kit: Kit, player: PlayerSnapshot, width: number): RenderElement {
  const { Box, Text } = kit
  const elapsed = formatTime(player.position)
  const total = formatTime(player.duration)
  const barWidth = Math.max(6, width - cellWidth(elapsed) - cellWidth(total) - 2)
  const ratio = player.duration && player.duration > 0 ? Math.min(1, Math.max(0, player.position / player.duration)) : 0
  const filled = Math.min(barWidth - 1, Math.round(ratio * (barWidth - 1)))
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text color={C.dim}>{elapsed}</Text>
      <Box flexDirection="row">
        <Text color={C.accent}>{'━'.repeat(filled)}</Text>
        <Text color={C.accent}>●</Text>
        <Text color={C.faint}>{'─'.repeat(barWidth - 1 - filled)}</Text>
      </Box>
      <Text color={C.dim}>{total}</Text>
    </Box>
  )
}

/** 播放控制：◀◀  ❚❚  ▶▶  ♡，不带方括号。 */
function Transport(
  kit: Kit,
  player: PlayerSnapshot,
  track: Track,
  library: LibraryResponse | null,
  actions: PaneActions,
  align: 'center' | 'flex-start',
): RenderElement {
  const { Box, Button } = kit
  const isFavorite = library?.favorites.some(t => trackKey(t) === trackKey(track)) ?? false
  return (
    <Box flexDirection="row" justifyContent={align} columnGap={4} width="100%">
      <Button key="prev" label="◀◀" plain onPress={() => actions.command({ type: 'prev' })} />
      <Button key="toggle" label={player.status === 'paused' ? '▶' : '❚❚'} plain onPress={() => actions.command({ type: 'toggle' })} />
      <Button key="next" label="▶▶" plain onPress={() => actions.command({ type: 'next' })} />
      <Button key="favorite" label={isFavorite ? '♥' : '♡'} plain onPress={() => actions.toggleFavorite(track)} />
    </Box>
  )
}

/** 音量和循环：音量 ━━━━━━────  60  −  +   循环 关 */
function Settings(kit: Kit, player: PlayerSnapshot, actions: PaneActions, align: 'center' | 'flex-start'): RenderElement {
  const { Box, Text, Button } = kit
  const level = Math.round(player.volume / 10)
  return (
    <Box flexDirection="row" justifyContent={align} columnGap={1} width="100%" marginTop={1}>
      <Text color={C.dim}>音量</Text>
      <Box flexDirection="row">
        <Text color={C.accent}>{'━'.repeat(level)}</Text>
        <Text color={C.faint}>{'─'.repeat(10 - level)}</Text>
      </Box>
      <Text color={C.dim}>{String(player.volume).padStart(3)}</Text>
      <Button key="vol-down" label="−" plain onPress={() => actions.command({ type: 'volume', delta: -10 })} />
      <Button key="vol-up" label="+" plain onPress={() => actions.command({ type: 'volume', delta: 10 })} />
      <Text> </Text>
      <Button
        key="repeat"
        label={REPEAT[player.repeat].label}
        plain
        dimColor={player.repeat === 'off'}
        onPress={() => actions.command({ type: 'repeat', mode: REPEAT[player.repeat].next })}
      />
    </Box>
  )
}

function ErrorLine(kit: Kit, player: PlayerSnapshot): RenderElement | null {
  const { Box, Text } = kit
  if (player.status !== 'error' || !player.error) return null
  return (
    <Box marginTop={1}>
      <Text color={C.error} wrap="wrap">
        {player.error}
      </Text>
    </Box>
  )
}

/** 歌词：每句按宽度折行后居中；当前句 Claude 橙加粗，越远越淡。 */
function Lyrics(kit: Kit, lyrics: LyricsState | null, track: Track, position: number, width: number, rows: number): RenderElement {
  const { Box, Text } = kit
  const note = (text: string) => (
    <Box flexDirection="column" alignItems="center" marginTop={1}>
      <Text color={C.dim}>{text}</Text>
    </Box>
  )
  if (!lyrics || lyrics.key !== trackKey(track)) return note('正在查找歌词…')
  if (lyrics.error) return note('查找歌词失败')

  const lineWidth = Math.max(10, width - 2)
  if (lyrics.synced) {
    const lines = lyrics.synced
    const current = currentLyricIndex(lines, position)
    const wrapped = lines.map(line => wrapText(line.text, lineWidth))
    // 当前句放在窗口上方三分之一处：先往前取几句，再往后填满
    let start = Math.max(0, current)
    let above = 0
    while (start > 0 && above + (wrapped[start - 1]?.length ?? 1) <= Math.floor(rows / 3)) {
      start -= 1
      above += wrapped[start]?.length ?? 1
    }
    const shown: { text: string; index: number }[] = []
    for (let i = start; i < lines.length && shown.length < rows; i += 1) {
      for (const text of wrapped[i] ?? []) {
        if (shown.length >= rows) break
        shown.push({ text, index: i })
      }
    }
    return (
      <Box flexDirection="column" alignItems="center" marginTop={1}>
        {shown.map(({ text, index }) => {
          if (index === current) {
            return (
              <Text color={C.accent} bold>
                {text}
              </Text>
            )
          }
          const distance = Math.abs(index - current)
          return <Text color={distance === 1 ? undefined : distance <= 3 ? C.dim : C.faint}>{text}</Text>
        })}
      </Box>
    )
  }

  if (lyrics.plain) {
    const lines = lyrics.plain
      .split(/\r?\n/)
      .filter(line => line.trim() !== '')
      .flatMap(line => wrapText(line, lineWidth))
      .slice(0, rows)
    return (
      <Box flexDirection="column" alignItems="center" marginTop={1}>
        {lines.map(line => (
          <Text color={C.dim}>{line}</Text>
        ))}
      </Box>
    )
  }
  return note('这首歌没有找到歌词')
}

type ItemButton = { id: string; label: string; onPress: () => void }

/**
 * 列表里的一首歌，两行：
 *   1   歌名（点它就播放）                 3:34
 *       歌手 · 来源                    加入  移除
 */
function TrackItem(
  kit: Kit,
  rowKey: string,
  primary: { id: string; onPress: () => void },
  index: number,
  track: Track,
  width: number,
  buttons: ItemButton[],
  note: string,
  isCurrent = false,
): RenderElement {
  const { Box, Text, Button } = kit
  const indexWidth = 4
  const noteWidth = Math.max(4, cellWidth(note))
  const titleWidth = Math.max(6, width - indexWidth - noteWidth - 1)
  const buttonsWidth = buttons.reduce((sum, b) => sum + cellWidth(b.label) + 2, 0)
  const provider = PROVIDER_NAME[track.provider] ?? track.provider
  const byline = truncate([track.artists.join(' / '), provider].filter(Boolean).join(' · '), Math.max(4, width - indexWidth - buttonsWidth - 1))
  return (
    <Box key={rowKey} flexDirection="column" marginBottom={1}>
      <Box flexDirection="row">
        <Box width={indexWidth} flexShrink={0}>
          <Text color={isCurrent ? C.accent : C.faint} bold={isCurrent ? true : undefined}>
            {isCurrent ? '♪' : String(index + 1)}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Button key={`${rowKey}-${primary.id}`} label={truncate(track.title, titleWidth)} plain onPress={primary.onPress} />
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Text color={C.dim}>{note}</Text>
        </Box>
      </Box>
      <Box flexDirection="row">
        <Box width={indexWidth} flexShrink={0} />
        <Box flexGrow={1} flexShrink={1}>
          <Text color={C.dim}>{byline}</Text>
        </Box>
        <Box flexDirection="row" columnGap={2} flexShrink={0} marginLeft={1}>
          {buttons.map(button => (
            <Button key={`${rowKey}-${button.id}`} label={button.label} plain dimColor onPress={button.onPress} />
          ))}
        </Box>
      </Box>
    </Box>
  )
}

/** 列表页顶上的一行：标题 · 数量，右边放几个操作。 */
function ListHeader(kit: Kit, title: string, count: string, buttons: ItemButton[]): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
      <Box flexDirection="row">
        <Text bold>{title}</Text>
        <Text color={C.dim}> · {count}</Text>
      </Box>
      <Box flexDirection="row" columnGap={2}>
        {buttons.map(button => (
          <Button key={button.id} label={button.label} plain dimColor onPress={button.onPress} />
        ))}
      </Box>
    </Box>
  )
}

function Empty(kit: Kit, title: string, hint: string): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column" alignItems="center" marginTop={2}>
      <Text color={C.accent}>♪</Text>
      <Text color={C.dim}>{title}</Text>
      {hint ? <Text color={C.faint}>{hint}</Text> : null}
    </Box>
  )
}

function SearchTab(kit: Kit, model: PaneModel, width: number, actions: PaneActions): RenderElement {
  const { Box, Text, Input } = kit
  const results = model.lastSearch
  return (
    <Box flexDirection="column" width={width}>
      {Input ? (
        <Box borderStyle="round" borderColor={C.border} paddingX={1}>
          <Input key="query" placeholder="歌名 歌手" value={model.search.query} submitLabel="搜索" autoFocus onSubmit={query => actions.search(query)} />
        </Box>
      ) : (
        <Text color={C.dim}>这里不能输入文字，请用 /music search 歌名。</Text>
      )}
      <Text color={C.faint}> 前缀 bili: 或 yt: 可以指定音源</Text>
      {model.search.isSearching ? (
        <Box marginTop={1}>
          <Text color={C.info}>搜索中…</Text>
        </Box>
      ) : null}
      {model.search.error ? (
        <Box marginTop={1}>
          <Text color={C.error} wrap="wrap">
            {model.search.error}
          </Text>
        </Box>
      ) : null}
      {results && !model.search.isSearching ? (
        <Box flexDirection="column" marginTop={1}>
          {ListHeader(kit, `「${truncate(results.query, Math.max(6, width - 24))}」`, `${PROVIDER_NAME[results.provider] ?? results.provider} ${results.tracks.length} 首`, [])}
          {results.tracks.length === 0 ? <Text color={C.dim}>没有结果，换个关键词试试。</Text> : null}
          {results.tracks.map((track, i) =>
            TrackItem(
              kit,
              `result-${i}`,
              { id: 'play', onPress: () => actions.play(track) },
              i,
              track,
              width,
              [{ id: 'add', label: '加入', onPress: () => actions.enqueue(track) }],
              formatTime(track.durationSec),
            ),
          )}
        </Box>
      ) : null}
    </Box>
  )
}

function QueueTab(kit: Kit, model: PaneModel, width: number, actions: PaneActions): RenderElement {
  const player = model.player
  if (!player || player.queue.length === 0) return Empty(kit, '队列是空的', '在「搜索」里点“加入”')
  const { Box } = kit
  const repeat = REPEAT[player.repeat]
  return (
    <Box flexDirection="column" width={width}>
      {ListHeader(kit, '队列', `${player.queue.length} 首`, [
        { id: 'queue-repeat', label: repeat.label, onPress: () => actions.command({ type: 'repeat', mode: repeat.next }) },
        { id: 'queue-clear', label: '清空', onPress: () => actions.command({ type: 'clear' }) },
      ])}
      {player.queue.slice(0, MAX_LIST).map((track, i) =>
        TrackItem(
          kit,
          `queue-${i}`,
          { id: 'jump', onPress: () => actions.command({ type: 'jump', index: i }) },
          i,
          track,
          width,
          [{ id: 'remove', label: '移除', onPress: () => actions.command({ type: 'remove', index: i }) }],
          formatTime(track.durationSec),
          i === player.index,
        ),
      )}
    </Box>
  )
}

function FavoritesTab(kit: Kit, model: PaneModel, width: number, actions: PaneActions): RenderElement {
  if (!model.library) return Empty(kit, '正在读取收藏…', '')
  const { favorites } = model.library
  if (favorites.length === 0) return Empty(kit, '还没有收藏', '播放时点 ♡ 或输入 /music fav')
  const { Box } = kit
  return (
    <Box flexDirection="column" width={width}>
      {ListHeader(kit, '收藏', `${favorites.length} 首`, [])}
      {favorites.slice(0, MAX_LIST).map((track, i) =>
        TrackItem(
          kit,
          `fav-${i}`,
          { id: 'play', onPress: () => actions.play(track) },
          i,
          track,
          width,
          [
            { id: 'add', label: '加入', onPress: () => actions.enqueue(track) },
            { id: 'unfav', label: '取消', onPress: () => actions.toggleFavorite(track) },
          ],
          formatTime(track.durationSec),
        ),
      )}
    </Box>
  )
}

function HistoryTab(kit: Kit, model: PaneModel, width: number, actions: PaneActions): RenderElement {
  if (!model.library) return Empty(kit, '正在读取播放历史…', '')
  const { history } = model.library
  if (history.length === 0) return Empty(kit, '还没有播放历史', '')
  const { Box } = kit
  return (
    <Box flexDirection="column" width={width}>
      {ListHeader(kit, '最近播放', `${history.length} 首`, [])}
      {history.slice(0, MAX_LIST).map((entry, i) =>
        TrackItem(
          kit,
          `history-${i}`,
          { id: 'play', onPress: () => actions.play(entry.track) },
          i,
          entry.track,
          width,
          [{ id: 'add', label: '加入', onPress: () => actions.enqueue(entry.track) }],
          timeAgo(entry.playedAt),
        ),
      )}
    </Box>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function even(value: number): number {
  return Math.floor(value / 2) * 2
}

export type MiniPlayerActions = {
  command: (cmd: PlayerCommand) => void;
  openPane: () => void;
}

/**
 * 输入框上方的迷你播放器，一行：
 *   ♪ 歌名 · 歌手            1:23 ━━━━●──── 3:34   b: ◀◀  p: ❚❚  n: ▶▶  o: 面板
 * 按钮带快捷键（迷你播放器获得焦点后按字母）。越窄收起越多。
 */
export function MiniPlayer(kit: Kit, player: PlayerSnapshot, track: Track, columns: number, actions: MiniPlayerActions): RenderElement {
  const { Box, Text, Button } = kit
  const status = player.status === 'playing' ? undefined : STATUS[player.status]
  const isWide = columns >= 100
  const hasSideButtons = columns >= 70
  const elapsed = formatTime(player.position)
  const total = formatTime(player.duration)
  const barWidth = isWide ? Math.min(24, columns - 76) : 0
  const ratio = player.duration && player.duration > 0 ? Math.min(1, Math.max(0, player.position / player.duration)) : 0
  const filled = Math.min(Math.max(0, barWidth - 1), Math.round(ratio * Math.max(0, barWidth - 1)))
  const byline = track.provider === 'bilibili' ? '' : track.artists.join(' / ')
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={8}>
          <Text color={C.accent}>♪ </Text>
          <Text bold wrap="truncate-end">
            {track.title}
          </Text>
          {byline ? (
            <Text color={C.dim} wrap="truncate-end">
              {' '}· {byline}
            </Text>
          ) : null}
        </Box>
        <Box flexDirection="row" flexShrink={0} marginLeft={2} columnGap={1}>
          {status ? <Text color={status.color}>{status.text}</Text> : null}
          <Text color={C.dim}>{barWidth >= 6 ? elapsed : `${elapsed}/${total}`}</Text>
          {barWidth >= 6 ? (
            <Box flexDirection="row">
              <Text color={C.accent}>{'━'.repeat(filled)}</Text>
              <Text color={C.accent}>●</Text>
              <Text color={C.faint}>{'─'.repeat(barWidth - 1 - filled)}</Text>
            </Box>
          ) : null}
          {barWidth >= 6 ? <Text color={C.dim}>{total}</Text> : null}
        </Box>
        <Box flexDirection="row" flexShrink={0} marginLeft={3} columnGap={2}>
          {hasSideButtons ? <Button key="prev" label="◀◀" hotkey="b" plain onPress={() => actions.command({ type: 'prev' })} /> : null}
          <Button
            key="toggle"
            label={player.status === 'paused' ? '▶' : '❚❚'}
            hotkey="p"
            plain
            onPress={() => actions.command({ type: 'toggle' })}
          />
          {hasSideButtons ? <Button key="next" label="▶▶" hotkey="n" plain onPress={() => actions.command({ type: 'next' })} /> : null}
          <Button key="panel" label="面板" hotkey="o" plain dimColor onPress={actions.openPane} />
        </Box>
      </Box>
      {player.status === 'error' && player.error ? (
        <Text color={C.error} wrap="truncate-end">
          {player.error}
        </Text>
      ) : null}
    </Box>
  )
}
