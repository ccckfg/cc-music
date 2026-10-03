// cc-music 面板的画法：纯函数，拿元素表、数据和动作，返回树；不碰 `$`。
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
import { currentLyricIndex, formatTime, progressBar, timeAgo, trackKey, trackLabel } from './format.ts'

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

const TABS: { id: PaneTab; label: string; hotkey: string }[] = [
  { id: 'now', label: '当前', hotkey: '1' },
  { id: 'search', label: '搜索', hotkey: '2' },
  { id: 'queue', label: '队列', hotkey: '3' },
  { id: 'favorites', label: '收藏', hotkey: '4' },
  { id: 'history', label: '历史', hotkey: '5' },
]

const STATUS_WORD: Record<PlayerSnapshot['status'], { text: string; color: string }> = {
  idle: { text: '已停止', color: 'gray' },
  loading: { text: '加载中', color: 'cyan' },
  playing: { text: '播放中', color: 'green' },
  paused: { text: '已暂停', color: 'yellow' },
  error: { text: '出错', color: 'red' },
}

const REPEAT_NEXT: Record<PlayerSnapshot['repeat'], { mode: PlayerSnapshot['repeat']; label: string }> = {
  off: { mode: 'all', label: '不循环' },
  all: { mode: 'one', label: '列表循环' },
  one: { mode: 'off', label: '单曲循环' },
}

/** 横排时歌词区显示几行；竖排的侧边栏里歌词占满剩下的高度 */
const LYRIC_ROWS = 9
/** 侧边栏里歌词上面的部分（标签、封面、曲目信息、按钮）大约占多少行 */
const SIDEBAR_HEADER_ROWS = 24
/** 当前行上面留几行 */
const LYRIC_ABOVE = 2
const PLAIN_LYRIC_ROWS = 14
/** 列表最多画多少行，再多就太长了 */
const MAX_LIST = 50
/** 横排时面板窄于这个宽度就不画封面 */
const MIN_COLUMNS_FOR_COVER = 44
/** 面板窄于这个宽度就竖着排 */
const MIN_COLUMNS_FOR_ROW = 60

export function PaneView(kit: Kit, model: PaneModel, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {TABS.map(tab => (
          <Button
            key={`tab-${tab.id}`}
            label={tab.label}
            hotkey={tab.hotkey}
            variant={tab.id === model.tab ? 'primary' : 'secondary'}
            onPress={() => actions.setTab(tab.id)}
          />
        ))}
      </Box>
      {model.outdatedDaemon ? (
        <Text color="yellow" wrap="wrap">
          后台播放器是旧版本（{model.outdatedDaemon}），歌词、封面和收藏要先运行 /music restart（会接着放当前的歌）。
        </Text>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {model.tab === 'now' ? NowTab(kit, model, actions) : null}
        {model.tab === 'search' ? SearchTab(kit, model, actions) : null}
        {model.tab === 'queue' ? QueueTab(kit, model, actions) : null}
        {model.tab === 'favorites' ? FavoritesTab(kit, model, actions) : null}
        {model.tab === 'history' ? HistoryTab(kit, model, actions) : null}
      </Box>
    </Box>
  )
}

function NowTab(kit: Kit, model: PaneModel, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Raster } = kit
  const player = model.player
  const track = player?.current
  if (!player || !track) {
    return <Text dimColor>还没有在播放。按 2 到「搜索」找一首，或者输入 /music 歌名。</Text>
  }

  const key = trackKey(track)
  const cover = model.cover?.key === key && model.cover.cells ? model.cover : undefined
  const isVertical = model.isDocked || model.columns < MIN_COLUMNS_FOR_ROW
  const showCover = Raster !== undefined && cover !== undefined && (isVertical || model.columns >= MIN_COLUMNS_FOR_COVER)
  const infoColumns = isVertical ? model.columns : model.columns - (showCover && cover ? cover.columns + 2 : 0)
  const isFavorite = model.library?.favorites.some(t => trackKey(t) === key) ?? false
  const word = STATUS_WORD[player.status]
  const repeat = REPEAT_NEXT[player.repeat]
  const subtitle = [track.artists.join(' / '), track.album, track.provider].filter(Boolean).join(' · ')
  const lyricRows = model.isDocked ? Math.max(6, model.rows - SIDEBAR_HEADER_ROWS) : LYRIC_ROWS

  const coverView =
    showCover && cover?.cells ? (
      <Box flexShrink={0} marginRight={isVertical ? 0 : 2} marginBottom={isVertical ? 1 : 0}>
        <Raster key="cover" columns={cover.columns} rows={cover.rows} cells={cover.cells} />
      </Box>
    ) : null

  // 竖排时进度条单独一行、占满宽度；横排时和状态、时间挤在一行
  const progress = isVertical ? (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" columnGap={1}>
        <Text color={word.color}>{word.text}</Text>
        <Text dimColor>
          {formatTime(player.position)} / {formatTime(player.duration)}
        </Text>
      </Box>
      <Text dimColor>{progressBar(player.position, player.duration, Math.max(8, infoColumns))}</Text>
    </Box>
  ) : (
    <Box flexDirection="row" columnGap={1} marginTop={1}>
      <Text color={word.color}>{word.text}</Text>
      <Text dimColor>
        {formatTime(player.position)} {progressBar(player.position, player.duration, Math.max(8, Math.min(40, infoColumns - 14)))}{' '}
        {formatTime(player.duration)}
      </Text>
    </Box>
  )

  const info = (
    <Box flexDirection="column" flexShrink={1} flexGrow={1}>
      <Text bold wrap="truncate-end">
        {track.title}
      </Text>
      <Text dimColor wrap="truncate-end">
        {subtitle}
      </Text>
      {progress}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
        <Button key="prev" label="上一首" hotkey="b" onPress={() => actions.command({ type: 'prev' })} />
        <Button
          key="toggle"
          label={player.status === 'paused' ? '播放' : '暂停'}
          hotkey="p"
          variant="primary"
          onPress={() => actions.command({ type: 'toggle' })}
        />
        <Button key="next" label="下一首" hotkey="n" onPress={() => actions.command({ type: 'next' })} />
        <Button key="favorite" label={isFavorite ? '已收藏' : '收藏'} hotkey="f" onPress={() => actions.toggleFavorite(track)} />
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Button key="vol-down" label="音量-" onPress={() => actions.command({ type: 'volume', delta: -10 })} />
        <Button key="vol-up" label="音量+" onPress={() => actions.command({ type: 'volume', delta: 10 })} />
        <Button key="repeat" label={repeat.label} onPress={() => actions.command({ type: 'repeat', mode: repeat.mode })} />
        <Text dimColor>音量 {player.volume}</Text>
      </Box>
    </Box>
  )

  return (
    <Box flexDirection="column">
      {isVertical ? (
        <Box flexDirection="column">
          {coverView}
          {info}
        </Box>
      ) : (
        <Box flexDirection="row">
          {coverView}
          {info}
        </Box>
      )}
      {player.status === 'error' && player.error ? (
        <Text color="red" wrap="wrap">
          {player.error}
        </Text>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {LyricsView(kit, model.lyrics, track, player.position, lyricRows)}
      </Box>
    </Box>
  )
}

function LyricsView(kit: Kit, lyrics: LyricsState | null, track: Track, position: number, rows: number): RenderElement {
  const { Box, Text } = kit
  if (!lyrics || lyrics.key !== trackKey(track)) return <Text dimColor>正在查找歌词…</Text>
  if (lyrics.error) return <Text dimColor>查找歌词失败：{lyrics.error}</Text>

  if (lyrics.synced) {
    const current = currentLyricIndex(lyrics.synced, position)
    const start = Math.max(0, Math.min(current - LYRIC_ABOVE, lyrics.synced.length - rows))
    const shown = lyrics.synced.slice(start, start + rows)
    return (
      <Box flexDirection="column">
        {shown.map((line, i) =>
          start + i === current ? (
            <Text bold color="cyan" wrap="truncate-end">
              {line.text}
            </Text>
          ) : (
            <Text dimColor wrap="truncate-end">
              {line.text}
            </Text>
          ),
        )}
      </Box>
    )
  }

  if (lyrics.plain) {
    const lines = lyrics.plain.split(/\r?\n/).filter(line => line.trim() !== '')
    return (
      <Box flexDirection="column">
        <Text dimColor>（这首只有不带时间轴的歌词）</Text>
        {lines.slice(0, Math.max(PLAIN_LYRIC_ROWS, rows)).map(line => (
          <Text wrap="truncate-end">{line}</Text>
        ))}
      </Box>
    )
  }
  return <Text dimColor>没有找到这首歌的歌词。</Text>
}

type RowButton = { id: string; label: string; onPress: () => void }

function TrackRow(kit: Kit, rowKey: string, index: number, track: Track, buttons: RowButton[], note: string, isCurrent = false): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box key={rowKey} flexDirection="row" columnGap={1}>
      {buttons.map(button => (
        <Button key={`${rowKey}-${button.id}`} label={button.label} onPress={button.onPress} />
      ))}
      <Box flexShrink={1} flexGrow={1}>
        <Text wrap="truncate-end" bold={isCurrent} color={isCurrent ? 'green' : undefined}>
          {`${isCurrent ? '▶' : ' '}${String(index + 1).padStart(2)}. ${trackLabel(track)}`}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text dimColor>{note}</Text>
      </Box>
    </Box>
  )
}

function SearchTab(kit: Kit, model: PaneModel, actions: PaneActions): RenderElement {
  const { Box, Text, Input } = kit
  const results = model.lastSearch
  return (
    <Box flexDirection="column">
      {Input ? (
        <Input
          key="query"
          label="搜索"
          placeholder="歌名 歌手（前缀 bili: 或 yt: 指定音源）"
          value={model.search.query}
          submitLabel="搜索"
          autoFocus
          onSubmit={query => actions.search(query)}
        />
      ) : (
        <Text dimColor>这里不能输入文字，请用 /music search 歌名。</Text>
      )}
      {model.search.isSearching ? <Text color="cyan">搜索中…</Text> : null}
      {model.search.error ? (
        <Text color="red" wrap="wrap">
          {model.search.error}
        </Text>
      ) : null}
      {results && !model.search.isSearching ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            {results.provider} 上「{results.query}」的结果：
          </Text>
          {results.tracks.length === 0 ? <Text dimColor>没有结果。</Text> : null}
          {results.tracks.map((track, i) =>
            TrackRow(
              kit,
              `result-${i}`,
              i,
              track,
              [
                { id: 'play', label: '播放', onPress: () => actions.play(track) },
                { id: 'add', label: '加入', onPress: () => actions.enqueue(track) },
              ],
              formatTime(track.durationSec),
            ),
          )}
        </Box>
      ) : null}
    </Box>
  )
}

function QueueTab(kit: Kit, model: PaneModel, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = kit
  const player = model.player
  if (!player || player.queue.length === 0) return <Text dimColor>队列是空的。</Text>
  const repeat = REPEAT_NEXT[player.repeat]
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        <Text dimColor>共 {player.queue.length} 首</Text>
        <Button key="queue-repeat" label={repeat.label} onPress={() => actions.command({ type: 'repeat', mode: repeat.mode })} />
        <Button key="queue-clear" label="清空" onPress={() => actions.command({ type: 'clear' })} />
      </Box>
      {player.queue.slice(0, MAX_LIST).map((track, i) =>
        TrackRow(
          kit,
          `queue-${i}`,
          i,
          track,
          [
            { id: 'jump', label: '播放', onPress: () => actions.command({ type: 'jump', index: i }) },
            { id: 'remove', label: '移除', onPress: () => actions.command({ type: 'remove', index: i }) },
          ],
          formatTime(track.durationSec),
          i === player.index,
        ),
      )}
    </Box>
  )
}

function FavoritesTab(kit: Kit, model: PaneModel, actions: PaneActions): RenderElement {
  const { Box, Text } = kit
  if (!model.library) return <Text dimColor>正在读取收藏…</Text>
  const { favorites } = model.library
  if (favorites.length === 0) return <Text dimColor>还没有收藏。播放时按 f 或输入 /music fav。</Text>
  return (
    <Box flexDirection="column">
      {favorites.slice(0, MAX_LIST).map((track, i) =>
        TrackRow(
          kit,
          `fav-${i}`,
          i,
          track,
          [
            { id: 'play', label: '播放', onPress: () => actions.play(track) },
            { id: 'add', label: '加入', onPress: () => actions.enqueue(track) },
            { id: 'unfav', label: '取消', onPress: () => actions.toggleFavorite(track) },
          ],
          formatTime(track.durationSec),
        ),
      )}
    </Box>
  )
}

function HistoryTab(kit: Kit, model: PaneModel, actions: PaneActions): RenderElement {
  const { Box, Text } = kit
  if (!model.library) return <Text dimColor>正在读取播放历史…</Text>
  const { history } = model.library
  if (history.length === 0) return <Text dimColor>还没有播放历史。</Text>
  return (
    <Box flexDirection="column">
      {history.slice(0, MAX_LIST).map((entry, i) =>
        TrackRow(
          kit,
          `history-${i}`,
          i,
          entry.track,
          [
            { id: 'play', label: '播放', onPress: () => actions.play(entry.track) },
            { id: 'add', label: '加入', onPress: () => actions.enqueue(entry.track) },
          ],
          timeAgo(entry.playedAt),
        ),
      )}
    </Box>
  )
}
