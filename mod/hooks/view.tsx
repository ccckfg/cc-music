// cc-music 面板的画法：纯函数，拿元素表、数据和动作，返回树；不碰 `$`。
// 颜色全用 Claude Code 的主题色名（见 theme.ts），跟着用户的主题走。
//
// 侧边栏常常只有二十几列宽：每一行都先算好各段宽度、截好文字，不靠 flex 收缩
// （收缩会把时长、按钮挤成两行）。橙色只用在当前标签、进度、当前歌词和选中的设置上。
import type {
  BoxProps,
  ButtonProps,
  ClientProps,
  ElementConstructor,
  InputProps,
  RasterProps,
  RenderElement,
  TextProps,
} from 'claude-code'

import type {
  ConfigPatch,
  ConfigResponse,
  CoverResponse,
  LastSearch,
  LibraryResponse,
  LyricsState,
  PaneTab,
  PlayerCommand,
  PlayerSnapshot,
  Prefs,
  SearchState,
  SettingsState,
  Track,
} from '../types'
import { coverCells } from './cover.ts'
import { currentLyricIndex, formatTime, timeAgo, titleParts, trackKey } from './format.ts'
import type { EqProps } from './fx/eq.tsx'
import type { LyricsProps } from './fx/lyrics.tsx'
import type { ProgressProps } from './fx/progress.tsx'
import type { NotesProps } from './fx/notes.tsx'
import type { PillProps } from './fx/pill.tsx'
import type { SwitchProps } from './fx/switch.tsx'
import type { TabsProps } from './fx/tabs.tsx'
import type { TransportProps } from './fx/transport.tsx'
import type { VolumeProps } from './fx/volume.tsx'
import type { VizProps } from './fx/viz.tsx'
import { icon, type IconName } from './icons.ts'
import { C, cellWidth, truncate, wrapText } from './theme.ts'

/**
 * 画面板用到的元素；Input、Raster、Client 不是每个界面都有。
 * Client 是动效：进度条、频谱、卡拉 OK 歌词、标签下划线、均衡器图标都是 fx/ 下的 surface module，
 * 在绘制线程上按自己的帧时钟重画，不用整个面板重画。没有 Client 的界面画静态版本。
 */
export type Kit = {
  Box: ElementConstructor<BoxProps>;
  Text: ElementConstructor<TextProps>;
  Button: ElementConstructor<ButtonProps>;
  Input?: ElementConstructor<InputProps>;
  Raster?: ElementConstructor<RasterProps>;
  Client?: ElementConstructor<ClientProps>;
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
  /** 面板内容区的行数；侧边栏从上到下占满它 */
  rows: number;
  /** daemon 是旧版本时它的版本号，面板提示用户 /music restart */
  outdatedDaemon: string | undefined;
  prefs: Prefs;
  /** 渐变色带（深到亮），按用户的主题挑的，见 theme.ts 的 rampFor */
  ramp: string[];
  /** 设置页从 daemon 读到的配置；还没打开过设置页时为 null */
  settings: SettingsState | null;
}

export type PaneActions = {
  command: (cmd: PlayerCommand) => void;
  setTab: (tab: PaneTab) => void;
  search: (query: string) => void;
  play: (track: Track) => void;
  enqueue: (track: Track) => void;
  toggleFavorite: (track: Track) => void;
  changeSettings: (patch: ConfigPatch) => void;
  changePrefs: (patch: Partial<Prefs>) => void;
  restartDaemon: () => void;
}

const TABS: { id: PaneTab; label: string }[] = [
  { id: 'now', label: '当前' },
  { id: 'search', label: '搜索' },
  { id: 'queue', label: '队列' },
  { id: 'favorites', label: '收藏' },
  { id: 'history', label: '历史' },
]
/** 标签之间的空格；放不下时缩成 1 */
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
  all: { next: 'one', label: '列表循环' },
  one: { next: 'off', label: '单曲循环' },
}

const PROVIDER_NAME: Record<string, string> = { bilibili: '哔哩哔哩', ytmusic: 'YouTube Music' }

/** 播放控制的字形：都在 Cascadia Mono 里（❚ ♡ 不在，会落到别的字体上，大小、位置都不齐） */
const GLYPH = { prev: '◀◀', next: '▶▶', play: '▶', pause: '▮▮', heart: '♥' } as const

/** 面板左右各留的空格 */
const PADDING = 1
/** 列表最多画多少首 */
const MAX_LIST = 50
/** 侧边栏里封面的宽度范围（格，取偶数：高度取一半，正好是正方形）；上限也让颜色对数留在 Raster 的 1024 以内 */
const COVER_MIN = 12
const COVER_MAX = 40
/**
 * 侧边栏「正在播放」里固定占的行数：标题栏 1、标签 1+2、内容上空 1、来源 1、
 * 进度 1+2、播放控制 1+1、循环和音量 1+1、歌词上空 1。封面、歌名、副标题、歌词另算
 */
const NOW_CHROME_ROWS = 14
/** 侧边栏里至少留给歌词的行数 */
const MIN_LYRIC_ROWS = 5
/** 横排（输入框上方）时封面的宽度和歌词行数 */
const INLINE_COVER = 20
const INLINE_LYRIC_ROWS = 5
/** 面板窄于这个宽度就竖着排 */
const MIN_COLUMNS_FOR_ROW = 64

export function PaneView(kit: Kit, model: PaneModel, actions: PaneActions): RenderElement {
  const { Box, Text } = kit
  const outer = Math.max(20, model.columns)
  const width = outer - PADDING * 2
  return (
    <Box flexDirection="column" width={outer} paddingX={PADDING}>
      {Header(kit, model, width, actions)}
      {/* 有 Client 时标题栏占两行（音符往下跳），标签栏不用再空一行 */}
      {TabBar(kit, model.tab, width, kit.Client ? 0 : 1, actions)}
      {model.outdatedDaemon ? (
        <Box marginTop={1} width={width}>
          <Text color={C.warning} wrap="wrap">
            后台播放器是旧版本（{model.outdatedDaemon}），歌词、封面和设置要先运行 /music restart。
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1} width={width}>
        {model.tab === 'now' ? NowTab(kit, model, width, actions) : null}
        {model.tab === 'search' ? SearchTab(kit, model, width, actions) : null}
        {model.tab === 'queue' ? QueueTab(kit, model, width, actions) : null}
        {model.tab === 'favorites' ? FavoritesTab(kit, model, width, actions) : null}
        {model.tab === 'history' ? HistoryTab(kit, model, width, actions) : null}
        {model.tab === 'settings' ? SettingsTab(kit, model, width, actions) : null}
      </Box>
    </Box>
  )
}

/** 每个标签的图标：♫ ≡ ♥ ◷ 在 Cascadia Mono 里，⌕ ⚙ 落到系统的符号字体上（引擎按一格算） */
const TAB_ICON: Record<PaneTab, string> = { now: '♫', search: '⌕', queue: '≡', favorites: '♥', history: '◷', settings: '⚙' }

/**
 * 第一行：渐变色的 ♪ cc-music，旁边是跳动的音符（占两行，往下跳到标签栏上面那一行空白里）。
 * 没有 Client 的界面：♪ cc-music ● 状态，右边「设置」按钮。
 */
function Header(kit: Kit, model: PaneModel, width: number, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Client } = kit
  const player = model.player
  const brand = [...'♪ cc-music']
  if (Client) {
    const notes: NotesProps = { status: player?.current ? player.status : 'none', ramp: model.ramp }
    return (
      <Box flexDirection="row" width={width}>
        <Box flexDirection="row">
          {brand.map((char, i) => (
            <Text color={model.ramp[Math.min(model.ramp.length - 1, 1 + Math.floor((i * 3) / brand.length))]} bold>
              {char}
            </Text>
          ))}
        </Box>
        <Box marginLeft={2}>
          <Client key="notes" module="./fx/notes.tsx" props={notes} width={5} height={2} />
        </Box>
      </Box>
    )
  }
  const status = player?.current ? STATUS[player.status] : undefined
  const isSettings = model.tab === 'settings'
  return (
    <Box flexDirection="row" justifyContent="space-between" width={width}>
      <Box flexDirection="row">
        <Text color={C.accent} bold>
          ♪ cc-music
        </Text>
        {status ? <Text color={status.color}> ●</Text> : null}
        {status && width >= 28 ? <Text color={C.dim}> {status.text}</Text> : null}
      </Box>
      <Button key="tab-settings" label="⚙ 设置" plain dimColor={!isSettings} onPress={() => actions.setTab(isSettings ? 'now' : 'settings')} />
    </Box>
  )
}

/**
 * 标签栏。有 Client 时：图标 + 文字，当前标签是橙色胶囊，⚙ 设置贴在最右边，鼠标悬停会亮，下划线滑动（fx/tabs.tsx）。
 * 没有 Client 时：文字按钮，下面一条细线、当前那段是橙色粗线。
 */
function TabBar(kit: Kit, active: PaneTab, width: number, marginTop: number, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Client } = kit
  if (Client) {
    const tab = (id: PaneTab) => ({ id, icon: TAB_ICON[id], label: TABS.find(t => t.id === id)?.label ?? '设置' })
    const props: TabsProps = { tabs: TABS.map(t => tab(t.id)), end: tab('settings'), active, width }
    return (
      <Box marginTop={marginTop} width={width}>
        <Client key="tabs" module="./fx/tabs.tsx" props={props} width={width} height={2} />
      </Box>
    )
  }
  const labels = TABS.reduce((sum, tab) => sum + cellWidth(tab.label), 0)
  const gap = labels + TAB_GAP * (TABS.length - 1) <= width ? TAB_GAP : 1
  const used = labels + gap * (TABS.length - 1)
  return (
    <Box flexDirection="column" marginTop={marginTop} width={width}>
      <Box flexDirection="row" columnGap={gap}>
        {TABS.map(tab => (
          <Button key={`tab-${tab.id}`} label={tab.label} plain dimColor={tab.id !== active} onPress={() => actions.setTab(tab.id)} />
        ))}
      </Box>
      <Box flexDirection="row">
        {TABS.map((tab, i) => (
          <Box flexDirection="row">
            <Text color={tab.id === active ? C.accent : C.faint}>{(tab.id === active ? '━' : '─').repeat(cellWidth(tab.label))}</Text>
            {i < TABS.length - 1 ? <Text color={C.faint}>{'─'.repeat(gap)}</Text> : null}
          </Box>
        ))}
        <Text color={C.faint}>{'─'.repeat(Math.max(0, width - used))}</Text>
      </Box>
    </Box>
  )
}


function NowTab(kit: Kit, model: PaneModel, width: number, actions: PaneActions): RenderElement {
  const { Box } = kit
  const player = model.player
  const track = player?.current
  if (!player || !track) {
    return Empty(kit, '还没有在播放', ['到「搜索」找一首', '或输入 /music 歌名'], 'vinyl')
  }
  // 有 Client 时 ♥ 在播放控制那一排，歌名能用满整行
  const hasHeartInTitle = !kit.Client
  const isFavorite = model.library?.favorites.some(t => trackKey(t) === trackKey(track)) ?? false
  const upNext = nextTrack(player)

  if (model.isDocked || width < MIN_COLUMNS_FOR_ROW) {
    // 竖着排：封面 → 歌名 → 频谱 → 进度 → 控制 → 音量 → 歌词 → 下一首。封面尽量大，但给歌词留够行数
    const info = trackInfo(track, hasHeartInTitle ? width - 2 : width)
    const errorRows = player.status === 'error' && player.error ? 1 + wrapText(player.error, width).length : 0
    const vizRows = kit.Client ? (model.rows >= 44 ? 2 : 1) : 0
    const fixedRows = NOW_CHROME_ROWS + (vizRows ? vizRows + 1 : 0) + info.titleLines.length + (info.detail ? 1 : 0) + errorRows
    const coverRows = model.rows - fixedRows - MIN_LYRIC_ROWS - 1
    const coverColumns = even(clamp(Math.min(width, coverRows * 2), COVER_MIN, COVER_MAX))
    const cover = model.prefs.showCover ? CoverArt(kit, model.cover, track, coverColumns) : null
    const usedRows = fixedRows + (cover ? coverColumns / 2 + 1 : 0)
    const spareRows = model.isDocked ? Math.max(MIN_LYRIC_ROWS, model.rows - usedRows) : INLINE_LYRIC_ROWS
    // 行数够时最下面加一行“下一首”
    const showsUpNext = model.isDocked && upNext !== undefined && spareRows >= MIN_LYRIC_ROWS + 2
    const lyricRows = showsUpNext ? spareRows - 2 : spareRows
    return (
      <Box flexDirection="column" width={width}>
        {cover ? (
          <Box flexDirection="column" alignItems="center" width={width} marginBottom={1}>
            {cover}
          </Box>
        ) : null}
        {TitleBlock(kit, track, info, width, isFavorite, hasHeartInTitle, actions)}
        {vizRows ? <Box marginTop={1}>{Visualizer(kit, player, track, width, vizRows, model.ramp)}</Box> : null}
        <Box marginTop={vizRows ? 0 : 1}>{Progress(kit, player, width, model.ramp)}</Box>
        <Box marginTop={1}>{Transport(kit, player, isFavorite, track, width, 'center', actions)}</Box>
        <Box marginTop={1}>{Secondary(kit, player, width, model.ramp, actions)}</Box>
        {ErrorLine(kit, player, width)}
        {SectionRule(kit, '♪ 歌词', width)}
        {Lyrics(kit, model.lyrics, player, track, width, lyricRows)}
        {showsUpNext && upNext ? <Box marginTop={1}>{UpNext(kit, upNext, width)}</Box> : null}
      </Box>
    )
  }

  // 输入框上方：封面在左，信息和控制在右，歌词在下
  const cover = model.prefs.showCover ? CoverArt(kit, model.cover, track, INLINE_COVER) : null
  const infoWidth = width - (cover ? INLINE_COVER + 3 : 0)
  const info = trackInfo(track, hasHeartInTitle ? infoWidth - 2 : infoWidth)
  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row" columnGap={3}>
        {cover}
        <Box flexDirection="column" width={infoWidth}>
          {TitleBlock(kit, track, info, infoWidth, isFavorite, hasHeartInTitle, actions)}
          {kit.Client ? <Box marginTop={1}>{Visualizer(kit, player, track, infoWidth, 1, model.ramp)}</Box> : null}
          <Box marginTop={kit.Client ? 0 : 1}>{Progress(kit, player, infoWidth, model.ramp)}</Box>
          <Box marginTop={1}>{Transport(kit, player, isFavorite, track, infoWidth, 'start', actions)}</Box>
          <Box marginTop={1}>{Secondary(kit, player, Math.min(infoWidth, 32), model.ramp, actions)}</Box>
          {ErrorLine(kit, player, infoWidth)}
        </Box>
      </Box>
      {SectionRule(kit, '♪ 歌词', width)}
      {Lyrics(kit, model.lyrics, player, track, width, INLINE_LYRIC_ROWS)}
    </Box>
  )
}

/** 队列里的下一首：列表循环时最后一首之后是第一首 */
function nextTrack(player: PlayerSnapshot): Track | undefined {
  const next = player.queue[player.index + 1]
  if (next) return next
  return player.repeat === 'all' && player.queue.length > 1 ? player.queue[0] : undefined
}

/** 一行“▸ 下一首  歌名 · UP 主” */
function UpNext(kit: Kit, track: Track, width: number): RenderElement {
  const { Box, Text } = kit
  const label = '下一首  '
  const title = titleParts(track).title
  const byline = track.artists.join(' / ')
  const room = width - 2 - cellWidth(label)
  const titleText = truncate(title, room)
  const bylineText = byline && room - cellWidth(titleText) >= 6 ? truncate(` · ${byline}`, room - cellWidth(titleText)) : ''
  return (
    <Box flexDirection="row" width={width}>
      <Text color={C.accent}>▸ </Text>
      <Text color={C.faint}>{label}</Text>
      <Text color={C.dim}>{titleText}</Text>
      {bylineText ? <Text color={C.faint}>{bylineText}</Text> : null}
    </Box>
  )
}

/** 居中带字的细线：──── ♪ 歌词 ──── */
function SectionRule(kit: Kit, label: string, width: number): RenderElement {
  const { Box, Text } = kit
  const side = Math.max(0, width - cellWidth(label) - 2)
  const left = Math.floor(side / 2)
  return (
    <Box flexDirection="row" width={width} marginTop={1}>
      <Text color={C.faint}>{'─'.repeat(left)} </Text>
      <Text color={C.dim}>{label}</Text>
      <Text color={C.faint}> {'─'.repeat(side - left)}</Text>
    </Box>
  )
}


/** 正方形封面，不加边框，格子都留给图；没有封面或界面画不了 Raster 时返回 null。 */
function CoverArt(kit: Kit, cover: CoverResponse | null, track: Track, columns: number): RenderElement | null {
  const { Box, Raster } = kit
  if (!Raster || !cover || cover.key !== trackKey(track)) return null
  const rows = columns / 2
  const cells = coverCells(cover, columns, rows)
  if (!cells) return null
  return (
    <Box flexShrink={0}>
      <Raster key="cover" columns={columns} rows={rows} cells={cells} />
    </Box>
  )
}

type TrackInfo = { titleLines: string[]; detail: string; source: string }

/**
 * 歌名最多两行（第二行放不下就截断），副标题一行，来源一行。
 * B 站：歌名从标题里拆出来，副标题是标题里剩下的（歌手、“超清现场”），来源是 UP 主；
 * YouTube Music：副标题是歌手，来源是专辑。
 */
function trackInfo(track: Track, titleWidth: number): TrackInfo {
  const parts = titleParts(track)
  const lines = wrapText(parts.title, titleWidth)
  const titleLines = lines.length > 2 ? [lines[0] ?? '', truncate(`${lines[1] ?? ''} ${lines.slice(2).join(' ')}`, titleWidth)] : lines
  const provider = PROVIDER_NAME[track.provider] ?? track.provider
  const artists = track.artists.join(' / ')
  if (track.provider === 'bilibili') {
    return { titleLines, detail: parts.detail, source: [artists ? `UP 主 ${artists}` : '', provider].filter(Boolean).join(' · ') }
  }
  return { titleLines, detail: artists, source: [track.album, provider].filter(Boolean).join(' · ') }
}

/** 歌名（粗体），下面是副标题和来源；没有 Client 的界面歌名右边放 ♥ 按钮（有 Client 时 ♥ 在播放控制里）。 */
function TitleBlock(kit: Kit, track: Track, info: TrackInfo, width: number, isFavorite: boolean, hasHeart: boolean, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row" justifyContent="space-between" width={width}>
        <Box flexDirection="column" width={hasHeart ? width - 2 : width}>
          {info.titleLines.map(line => (
            <Text bold>{line}</Text>
          ))}
        </Box>
        {hasHeart ? <Button key="favorite" label={GLYPH.heart} plain dimColor={!isFavorite} onPress={() => actions.toggleFavorite(track)} /> : null}
      </Box>
      {info.detail ? <Text color={C.dim}>{truncate(info.detail, width)}</Text> : null}
      <Text color={C.faint}>{truncate(info.source, width)}</Text>
    </Box>
  )
}

/**
 * 进度：整行的进度条，下面一行左右两头是时间。有 Client 时是动的：
 * 两次轮询之间按帧往前走、已播部分有流光，中间是 Claude Code 思考时那样的转圈 + 状态字。
 */
function Progress(kit: Kit, player: PlayerSnapshot, width: number, ramp: string[]): RenderElement {
  const { Box, Text, Client } = kit
  if (Client) {
    const props: ProgressProps = { position: player.position, duration: player.duration, status: player.status, width, ramp }
    return <Client key="progress" module="./fx/progress.tsx" props={props} width={width} height={2} />
  }
  const ratio = player.duration && player.duration > 0 ? Math.min(1, Math.max(0, player.position / player.duration)) : 0
  const filled = Math.min(width - 1, Math.round(ratio * (width - 1)))
  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row">
        <Text color={C.accent}>{'━'.repeat(filled)}</Text>
        <Text color={C.accent}>●</Text>
        <Text color={C.faint}>{'─'.repeat(width - 1 - filled)}</Text>
      </Box>
      <Box flexDirection="row" justifyContent="space-between" width={width}>
        <Text color={C.dim}>{formatTime(player.position)}</Text>
        <Text color={C.dim}>{formatTime(player.duration)}</Text>
      </Box>
    </Box>
  )
}

/**
 * 播放控制。有 Client 时：↻ 循环、◀◀、实心橙色胶囊的 ▶/▮▮、▶▶、♥，悬停会亮，点了发消息（fx/transport.tsx）。
 * 没有 Client 时：◀◀  ▮▮  ▶▶ 三个按钮。
 */
function Transport(
  kit: Kit,
  player: PlayerSnapshot,
  isFavorite: boolean,
  track: Track,
  width: number,
  align: 'center' | 'start',
  actions: PaneActions,
): RenderElement {
  const { Box, Button, Client } = kit
  if (Client) {
    const props: TransportProps = { status: player.status, repeat: player.repeat, isFavorite, width, align }
    return <Client key="transport" module="./fx/transport.tsx" props={props} width={width} height={1} />
  }
  return (
    <Box flexDirection="row" justifyContent={align === 'center' ? 'center' : 'flex-start'} columnGap={width >= 30 ? 6 : 4} width={width}>
      <Button key="prev" label={GLYPH.prev} plain onPress={() => actions.command({ type: 'prev' })} />
      <Button key="toggle" label={player.status === 'paused' ? GLYPH.play : GLYPH.pause} plain onPress={() => actions.command({ type: 'toggle' })} />
      <Button key="next" label={GLYPH.next} plain onPress={() => actions.command({ type: 'next' })} />
    </Box>
  )
}

/**
 * 第二行控制。有 Client 时：可以点、可以拖的阶梯音量条（fx/volume.tsx）。
 * 没有 Client 时：左边循环模式，右边音量 − 60 +（宽的时候带一条音量条）。
 */
function Secondary(kit: Kit, player: PlayerSnapshot, width: number, ramp: string[], paneActions: PaneActions): RenderElement {
  const { Box, Text, Button, Client } = kit
  if (Client) {
    const props: VolumeProps = { volume: player.volume, width, ramp }
    return <Client key="volume" module="./fx/volume.tsx" props={props} width={width} height={1} />
  }
  const repeat = REPEAT[player.repeat]
  const level = Math.round(player.volume / 10)
  return (
    <Box flexDirection="row" justifyContent="space-between" width={width}>
      <Button
        key="repeat"
        label={repeat.label}
        plain
        dimColor={player.repeat === 'off'}
        onPress={() => paneActions.command({ type: 'repeat', mode: repeat.next })}
      />
      <Box flexDirection="row" columnGap={1}>
        <Text color={C.dim}>音量</Text>
        {width >= 40 ? (
          <Box flexDirection="row">
            <Text color={C.accent}>{'━'.repeat(level)}</Text>
            <Text color={C.faint}>{'─'.repeat(10 - level)}</Text>
          </Box>
        ) : null}
        <Button key="vol-down" label="−" plain onPress={() => paneActions.command({ type: 'volume', delta: -10 })} />
        <Text>{String(player.volume).padStart(3)}</Text>
        <Button key="vol-up" label="+" plain onPress={() => paneActions.command({ type: 'volume', delta: 10 })} />
      </Box>
    </Box>
  )
}

function ErrorLine(kit: Kit, player: PlayerSnapshot, width: number): RenderElement | null {
  const { Box, Text } = kit
  if (player.status !== 'error' || !player.error) return null
  return (
    <Box marginTop={1} width={width}>
      <Text color={C.error} wrap="wrap">
        {player.error}
      </Text>
    </Box>
  )
}

/** 频谱：一排随节拍跳动的柱子（只在有 Client 的界面上画）。 */
function Visualizer(kit: Kit, player: PlayerSnapshot, track: Track, width: number, rows: number, ramp: string[]): RenderElement | null {
  const { Client } = kit
  if (!Client) return null
  const props: VizProps = { status: player.status, width, rows, seed: trackKey(track), ramp }
  return <Client key="viz" module="./fx/viz.tsx" props={props} width={width} height={rows} />
}

/**
 * 歌词：每句按宽度折行后居中，越远越淡。有 Client 时是卡拉 OK：正在唱的那句从左往右染成 Claude 橙；
 * 没有 Client 时整句橙色加粗。
 */
function Lyrics(kit: Kit, lyrics: LyricsState | null, player: PlayerSnapshot, track: Track, width: number, rows: number): RenderElement {
  const { Box, Text, Client } = kit
  const position = player.position
  const note = (text: string) => (
    <Box flexDirection="column" alignItems="center" width={width}>
      <Text color={C.faint}>{text}</Text>
    </Box>
  )
  if (!lyrics || lyrics.key !== trackKey(track)) return note('正在查找歌词…')
  if (lyrics.error) return note('查找歌词失败')

  const lineWidth = Math.max(10, width - 2)
  if (lyrics.synced && Client) {
    const props: LyricsProps = {
      rows: lyrics.synced.flatMap((line, i) => wrapText(line.text, lineWidth).map(text => ({ text, line: i }))),
      times: lyrics.synced.map(line => line.time),
      position,
      duration: player.duration,
      status: player.status,
      width,
      height: rows,
    }
    return (
      <Box width={width}>
        <Client key="lyrics" module="./fx/lyrics.tsx" props={props} width={width} height={rows} />
      </Box>
    )
  }
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
      <Box flexDirection="column" alignItems="center" width={width}>
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
      <Box flexDirection="column" alignItems="center" width={width}>
        {lines.map(line => (
          <Text color={C.dim}>{line}</Text>
        ))}
      </Box>
    )
  }
  return note('这首歌没有找到歌词')
}

/** 列表行右边的小按钮：+ 加入、× 移除、♥ 取消收藏 */
type ItemButton = { id: string; label: string; onPress: () => void }

/**
 * 列表里的一首歌，两行，各段宽度先算好：
 *   1  歌名（点它就播放）          3:34
 *      UP 主 · 标题里的修饰         +  ×
 * 当前播放的那首，序号换成跳动的均衡器（没有 Client 时是橙色的 ♪）。
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
  /** 这首是当前曲目时传播放状态 */
  current?: PlayerSnapshot['status'],
): RenderElement {
  const { Box, Text, Button, Client } = kit
  const isCurrent = current !== undefined
  const indexWidth = 3
  const noteWidth = cellWidth(note)
  const titleWidth = Math.max(4, width - indexWidth - noteWidth - 1)
  const buttonsWidth = buttons.reduce((sum, b) => sum + cellWidth(b.label), 0) + 2 * Math.max(0, buttons.length - 1)
  const bylineWidth = Math.max(4, width - indexWidth - buttonsWidth - 1)
  const parts = titleParts(track)
  const byline = [track.artists.join(' / '), track.provider === 'bilibili' ? parts.detail : track.album].filter(Boolean).join(' · ')
  return (
    <Box key={rowKey} flexDirection="column" width={width}>
      <Box flexDirection="row" width={width}>
        <Box width={indexWidth} flexShrink={0}>
          {current && Client ? (
            <Client key={`${rowKey}-eq`} module="./fx/eq.tsx" props={{ status: current, bars: 2 } satisfies EqProps} width={2} height={1} />
          ) : (
            <Text color={isCurrent ? C.accent : C.faint} bold={isCurrent ? true : undefined}>
              {isCurrent ? '♪' : String(index + 1)}
            </Text>
          )}
        </Box>
        <Box width={titleWidth} flexShrink={0}>
          <Button key={`${rowKey}-${primary.id}`} label={truncate(parts.title, titleWidth)} plain hover={{ color: C.accent, bold: true }} onPress={primary.onPress} />
        </Box>
        <Box width={noteWidth + 1} flexShrink={0} justifyContent="flex-end">
          <Text color={C.faint}>{note}</Text>
        </Box>
      </Box>
      <Box flexDirection="row" width={width}>
        <Box width={indexWidth} flexShrink={0} />
        <Box width={bylineWidth} flexShrink={0}>
          <Text color={C.dim} hover={{ color: C.accentSoft }}>
            {truncate(byline, bylineWidth)}
          </Text>
        </Box>
        <Box width={buttonsWidth + 1} flexShrink={0} flexDirection="row" justifyContent="flex-end" columnGap={2}>
          {buttons.map(button => (
            <Button key={`${rowKey}-${button.id}`} label={button.label} plain dimColor onPress={button.onPress} />
          ))}
        </Box>
      </Box>
    </Box>
  )
}

/** 列表页顶上的一行：标题 数量，右边放几个操作；下面空一行。 */
function ListHeader(kit: Kit, title: string, count: string, width: number, buttons: ItemButton[]): RenderElement {
  const { Box, Text, Button } = kit
  const summaryWidth = cellWidth(title) + 3 + cellWidth(count)
  const buttonsWidth = buttons.reduce((sum, button) => sum + cellWidth(button.label), 0) + 2 * Math.max(0, buttons.length - 1)
  const summary = (
    <Box flexDirection="row">
      <Text bold>{title}</Text>
      <Text color={C.faint}> · </Text>
      <Text color={C.dim}>{truncate(count, Math.max(4, width - cellWidth(title) - 3))}</Text>
    </Box>
  )
  const actions = (
    <Box flexDirection="row" columnGap={2}>
      {buttons.map(button => (
        <Button key={button.id} label={button.label} plain dimColor hover={{ color: C.accent }} onPress={button.onPress} />
      ))}
    </Box>
  )
  // 窄侧边栏里一行放不下：操作挪到第二行、靠右
  if (buttons.length > 0 && summaryWidth + 2 + buttonsWidth > width) {
    return (
      <Box flexDirection="column" width={width} marginBottom={1}>
        {summary}
        <Box key="list-actions" flexDirection="row" justifyContent="flex-end" width={width}>
          {actions}
        </Box>
      </Box>
    )
  }
  return (
    <Box key="list-actions" flexDirection="row" justifyContent="space-between" width={width} marginBottom={1}>
      {summary}
      {actions}
    </Box>
  )
}

/**
 * 空状态：一个像素画的图标（终端上；别处是橙色的 ♪）、一句说明，
 * 下面几行提示（每行都短，窄侧边栏里不会断得难看）。
 */
/** “ · 42:13”：一组歌的总时长，有不知道时长的就不写 */
function totalTime(tracks: Track[]): string {
  if (tracks.length === 0 || tracks.some(track => !track.durationSec)) return ''
  return ` · ${formatTime(tracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0))}`
}

function Empty(kit: Kit, title: string, hints: string[] = [], picture?: IconName): RenderElement {
  const { Box, Text, Raster } = kit
  const art = picture && Raster ? icon(picture) : undefined
  return (
    <Box flexDirection="column" alignItems="center" marginTop={2}>
      {art && Raster ? (
        <Box marginBottom={1}>
          <Raster key={`icon-${picture}`} columns={art.columns} rows={art.rows} cells={art.cells} />
        </Box>
      ) : (
        <Text color={C.accent}>♪</Text>
      )}
      <Text color={C.dim}>{title}</Text>
      {hints.map(hint => (
        <Text color={C.faint}>{hint}</Text>
      ))}
    </Box>
  )
}

function SearchTab(kit: Kit, model: PaneModel, width: number, actions: PaneActions): RenderElement {
  const { Box, Text, Input } = kit
  const results = model.lastSearch
  return (
    <Box flexDirection="column" width={width}>
      {Input ? (
        <Box borderStyle="round" borderColor={C.border} paddingX={1} width={width} flexDirection="row">
          <Text color={C.accent}>⌕ </Text>
          <Input key="query" placeholder="歌名 歌手" value={model.search.query} submitLabel="搜索" autoFocus onSubmit={query => actions.search(query)} />
        </Box>
      ) : (
        <Text color={C.dim}>这里不能输入文字，请用 /music search 歌名。</Text>
      )}
      <Text color={C.faint}>{truncate('bili: / yt: 前缀切换音源', width)}</Text>
      {model.search.isSearching ? (
        <Box marginTop={1}>
          <Text color={C.info}>搜索中…</Text>
        </Box>
      ) : null}
      {model.search.error ? (
        <Box marginTop={1} width={width}>
          <Text color={C.error} wrap="wrap">
            {model.search.error}
          </Text>
        </Box>
      ) : null}
      {results && !model.search.isSearching ? (
        <Box flexDirection="column" marginTop={1} width={width}>
          {ListHeader(kit, '⌕ 结果', `${results.tracks.length} 首 · ${PROVIDER_NAME[results.provider] ?? results.provider}`, width, [])}
          {results.tracks.length === 0 ? <Text color={C.dim}>没有结果，换个关键词试试。</Text> : null}
          {results.tracks.map((track, i) =>
            TrackItem(
              kit,
              `result-${i}`,
              { id: 'play', onPress: () => actions.play(track) },
              i,
              track,
              width,
              [{ id: 'add', label: '+', onPress: () => actions.enqueue(track) }],
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
  if (!player || player.queue.length === 0) return Empty(kit, '队列是空的', ['在「搜索」里点 + 加入'], 'list')
  const { Box } = kit
  const repeat = REPEAT[player.repeat]
  return (
    <Box flexDirection="column" width={width}>
      {ListHeader(kit, '≡ 队列', `${player.queue.length} 首${totalTime(player.queue)}`, width, [
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
          [{ id: 'remove', label: '×', onPress: () => actions.command({ type: 'remove', index: i }) }],
          formatTime(track.durationSec),
          i === player.index ? player.status : undefined,
        ),
      )}
    </Box>
  )
}

function FavoritesTab(kit: Kit, model: PaneModel, width: number, actions: PaneActions): RenderElement {
  if (!model.library) return Empty(kit, '正在读取收藏…')
  const { favorites } = model.library
  if (favorites.length === 0) return Empty(kit, '还没有收藏', ['播放时点 ♥', '或输入 /music fav'], 'heart')
  const { Box } = kit
  return (
    <Box flexDirection="column" width={width}>
      {ListHeader(kit, '♥ 收藏', `${favorites.length} 首${totalTime(favorites)}`, width, [])}
      {favorites.slice(0, MAX_LIST).map((track, i) =>
        TrackItem(
          kit,
          `fav-${i}`,
          { id: 'play', onPress: () => actions.play(track) },
          i,
          track,
          width,
          [
            { id: 'add', label: '+', onPress: () => actions.enqueue(track) },
            { id: 'unfav', label: '×', onPress: () => actions.toggleFavorite(track) },
          ],
          formatTime(track.durationSec),
        ),
      )}
    </Box>
  )
}

function HistoryTab(kit: Kit, model: PaneModel, width: number, actions: PaneActions): RenderElement {
  if (!model.library) return Empty(kit, '正在读取播放历史…')
  const { history } = model.library
  if (history.length === 0) return Empty(kit, '还没有播放历史', ['放过的歌会出现在这里'], 'clock')
  const { Box } = kit
  return (
    <Box flexDirection="column" width={width}>
      {ListHeader(kit, '◷ 最近播放', `${history.length} 首`, width, [])}
      {history.slice(0, MAX_LIST).map((entry, i) =>
        TrackItem(
          kit,
          `history-${i}`,
          { id: 'play', onPress: () => actions.play(entry.track) },
          i,
          entry.track,
          width,
          [{ id: 'add', label: '+', onPress: () => actions.enqueue(entry.track) }],
          timeAgo(entry.playedAt),
        ),
      )}
    </Box>
  )
}

/**
 * 设置页的一个控件：一行时的样子和宽度；太宽放不下时 stacked 是竖着排的样子。
 */
type Control = { element: RenderElement; width: number; stacked?: RenderElement }

type Choice<T> = { value: T; label: string }

const PROVIDER_CHOICES: Choice<string>[] = Object.entries(PROVIDER_NAME).map(([value, label]) => ({ value, label }))

/** 空闲自动退出的选项（分钟，0 是不退出），‹ › 在里面轮换 */
const IDLE_CHOICES = [10, 30, 60, 0]

/** 每组设置标题前的图标（都在 Cascadia Mono 里） */
const SECTION_ICON = { play: '♫', look: '◐', youtube: '▶', daemon: '◎' } as const

/**
 * 设置页。「播放」「YouTube Music」「后台播放器」改的是 daemon 的 config.json，
 * 「界面」是面板自己的偏好，存在 $.store 里。
 * 开关画成 ━━● 开 / ●── 关，单选画成 ● ○，数值用 ‹ › 或 − + 调；一项放不下一行时名字一行、控件一行。
 */
function SettingsTab(kit: Kit, model: PaneModel, width: number, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = kit
  const prefs = model.prefs
  const state = model.settings
  const config = state?.config ?? null
  const daemonNote = !state || (!config && !state.error) ? (
    <Text color={C.dim}>正在读取后台播放器的设置…</Text>
  ) : !config ? (
    <Text color={C.error} wrap="wrap">
      读不到设置：{state.error}
    </Text>
  ) : null

  return (
    <Box flexDirection="column" width={width}>
      {config && state?.error ? (
        <Box marginBottom={1} width={width}>
          <Text color={C.error} wrap="wrap">
            × {state.error}
          </Text>
        </Box>
      ) : null}
      {Section(kit, SECTION_ICON.play, '播放', width, [
        daemonNote,
        config
          ? Setting(kit, width, '默认音源', Radio(kit, 'provider', PROVIDER_CHOICES, config.settings.defaultProvider, value => actions.changeSettings({ defaultProvider: value })))
          : null,
        config ? Setting(kit, width, '启动音量', VolumeStepper(kit, config.settings.volume, actions)) : null,
      ])}
      {Section(kit, SECTION_ICON.look, '界面', width, [
        Setting(kit, width, '迷你播放器', Switch(kit, 'mini-player', 'showMiniPlayer', prefs.showMiniPlayer, value => actions.changePrefs({ showMiniPlayer: value }))),
        Setting(kit, width, '自动打开侧边栏', Switch(kit, 'auto-sidebar', 'autoOpenSidebar', prefs.autoOpenSidebar, value => actions.changePrefs({ autoOpenSidebar: value }))),
        Setting(kit, width, '封面', Switch(kit, 'cover', 'showCover', prefs.showCover, value => actions.changePrefs({ showCover: value }))),
      ])}
      {config ? Section(kit, SECTION_ICON.youtube, 'YouTube Music', width, [Cookies(kit, config, width, actions)]) : null}
      {Section(kit, SECTION_ICON.daemon, '后台播放器', width, [
        config ? Setting(kit, width, '空闲自动退出', IdleStepper(kit, config.settings.idleExitMinutes, actions)) : null,
        config ? Tools(kit, config, width) : null,
        <Box marginTop={1}>
          {kit.Client ? (
            <kit.Client key="restart-daemon" module="./fx/pill.tsx" props={{ label: '↻ 重启后台播放器', action: 'restart' } satisfies PillProps} width={18} height={1} />
          ) : (
            <Button key="restart-daemon" label="▸ 重启后台播放器" plain onPress={actions.restartDaemon} />
          )}
        </Box>,
        config ? <Text color={C.faint}>{truncateMiddle(config.configFile, width)}</Text> : null,
      ])}
    </Box>
  )
}

/** 一组设置：橙色图标、粗体组名，后面一条细线拉到行尾 */
function Section(kit: Kit, glyph: string, title: string, width: number, children: (RenderElement | null)[]): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column" marginBottom={1} width={width}>
      <Box flexDirection="row">
        <Text color={C.accent}>{glyph} </Text>
        <Text bold>{title}</Text>
        <Text color={C.faint}> {'─'.repeat(Math.max(0, width - cellWidth(title) - 3))}</Text>
      </Box>
      {children}
    </Box>
  )
}

function Setting(kit: Kit, width: number, label: string, control: Control): RenderElement {
  const { Box, Text } = kit
  if (cellWidth(label) + 2 + control.width <= width) {
    return (
      <Box flexDirection="row" justifyContent="space-between" width={width}>
        <Text color={C.dim}>{label}</Text>
        {control.element}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" width={width}>
      <Text color={C.dim}>{label}</Text>
      {control.width + 2 <= width || !control.stacked ? (
        <Box flexDirection="row" justifyContent="flex-end" width={width}>
          {control.element}
        </Box>
      ) : (
        <Box paddingLeft={2}>{control.stacked}</Box>
      )}
    </Box>
  )
}

/**
 * 开关：开着是亮的 ━━● 和橙色的“开”，关着是淡的 ●── 和“关”。按 ━━● 那一段切换；
 * 按钮的 key 是 `<key>-<按下后的值>`。
 */
function Switch(kit: Kit, key: string, name: keyof Prefs, isOn: boolean, onChange: (value: boolean) => void): Control {
  const { Box, Text, Button, Client } = kit
  if (Client) {
    const props: SwitchProps = { name, isOn }
    return { width: 8, element: <Client key={`switch-${key}`} module="./fx/switch.tsx" props={props} width={8} height={1} /> }
  }
  return {
    width: 6,
    element: (
      <Box flexDirection="row" columnGap={1}>
        <Button key={`${key}-${String(!isOn)}`} label={isOn ? '━━●' : '●──'} plain dimColor={!isOn} onPress={() => onChange(!isOn)} />
        <Text color={isOn ? C.accent : C.faint} bold={isOn ? true : undefined}>
          {isOn ? '开' : '关'}
        </Text>
      </Box>
    ),
  }
}

/** 单选：选中的是橙色的 ● 和名字，其余是淡色的 ○ 按钮（key 是 `<key>-<值>`）；太宽时一项一行 */
function Radio<T>(kit: Kit, key: string, choices: Choice<T>[], current: T, onChange: (value: T) => void): Control {
  const { Box, Text, Button } = kit
  const gap = 2
  const item = (choice: Choice<T>) =>
    choice.value === current ? (
      <Text color={C.accent} bold>
        ● {choice.label}
      </Text>
    ) : (
      <Button key={`${key}-${String(choice.value)}`} label={`○ ${choice.label}`} plain dimColor onPress={() => onChange(choice.value)} />
    )
  return {
    width: choices.reduce((sum, choice) => sum + 2 + cellWidth(choice.label), 0) + gap * (choices.length - 1),
    element: (
      <Box flexDirection="row" columnGap={gap}>
        {choices.map(item)}
      </Box>
    ),
    stacked: <Box flexDirection="column">{choices.map(item)}</Box>,
  }
}

function VolumeStepper(kit: Kit, volume: number, actions: PaneActions): Control {
  const { Box, Text, Button } = kit
  return {
    width: 7,
    element: (
      <Box flexDirection="row" columnGap={1}>
        <Button key="startup-vol-down" label="−" plain onPress={() => actions.changeSettings({ volume: Math.max(0, volume - 10) })} />
        <Text color={C.accent} bold>
          {String(volume).padStart(3)}
        </Text>
        <Button key="startup-vol-up" label="+" plain onPress={() => actions.changeSettings({ volume: Math.min(100, volume + 10) })} />
      </Box>
    ),
  }
}

/** 空闲自动退出：‹ 30 分钟 › 在几个选项里轮换；配置里是别的分钟数时也算一档 */
function IdleStepper(kit: Kit, minutes: number, actions: PaneActions): Control {
  const { Box, Text, Button } = kit
  const values = IDLE_CHOICES.includes(minutes) ? IDLE_CHOICES : [...IDLE_CHOICES.slice(0, -1), minutes].sort((a, b) => a - b).concat(0)
  const index = Math.max(0, values.indexOf(minutes))
  const pick = (step: number) => values[(index + step + values.length) % values.length] ?? 30
  const label = minutes === 0 ? '不退出' : `${minutes} 分钟`
  return {
    width: 4 + Math.max(cellWidth(label), 7),
    element: (
      <Box flexDirection="row" columnGap={1}>
        <Button key="idle-prev" label="‹" plain onPress={() => actions.changeSettings({ idleExitMinutes: pick(-1) })} />
        <Box width={7} justifyContent="center">
          <Text color={C.accent} bold>
            {label}
          </Text>
        </Box>
        <Button key="idle-next" label="›" plain onPress={() => actions.changeSettings({ idleExitMinutes: pick(1) })} />
      </Box>
    ),
  }
}

/** cookies 文件：YouTube 拦截播放时要用。名字右边是状态，下面是输入框 */
function Cookies(kit: Kit, config: ConfigResponse, width: number, actions: PaneActions): RenderElement {
  const { Box, Text, Input } = kit
  const path = config.settings.cookiesFile
  const status = !path
    ? { color: C.warning, text: '▲ 没有配置' }
    : config.hasCookiesFile
      ? { color: C.success, text: '✓ 已配置' }
      : { color: C.error, text: '× 找不到这个文件' }
  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row" justifyContent="space-between" width={width}>
        <Text color={C.dim}>cookies 文件</Text>
        <Text color={status.color}>{status.text}</Text>
      </Box>
      {Input ? (
        <Box borderStyle="round" borderColor={C.border} paddingX={1} width={width}>
          <Input key="cookies" placeholder="cookies.txt 的路径" value={path} submitLabel="保存" onSubmit={text => actions.changeSettings({ cookiesFile: text })} />
        </Box>
      ) : (
        <Text>{truncateMiddle(path || '（未设置）', width)}</Text>
      )}
      {config.hasCookiesFile ? null : (
        <Text color={C.faint} wrap="wrap">
          播放被 YouTube 拦截时需要：用浏览器扩展导出后填完整路径，回车保存
        </Text>
      )}
    </Box>
  )
}

/** mpv、yt-dlp、ffmpeg 找没找到 */
function Tools(kit: Kit, config: ConfigResponse, width: number): RenderElement {
  const { Box, Text } = kit
  const tools: [string, string | null][] = [
    ['mpv', config.tools.mpv],
    ['yt-dlp', config.tools.ytdlp],
    ['ffmpeg', config.tools.ffmpeg],
  ]
  const isMissing = tools.some(([, path]) => !path)
  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row" columnGap={width >= 26 ? 2 : 1}>
        {tools.map(([name, path]) => (
          <Box flexDirection="row">
            <Text color={C.dim}>{name} </Text>
            <Text color={path ? C.success : C.error}>{path ? '✓' : '×'}</Text>
          </Box>
        ))}
      </Box>
      {isMissing ? (
        <Text color={C.faint} wrap="wrap">
          缺的工具用 scoop 安装，或在配置文件里写路径
        </Text>
      ) : null}
    </Box>
  )
}

/** 路径之类的长文字：截掉中间，两头都留着 */
function truncateMiddle(text: string, width: number): string {
  if (cellWidth(text) <= width) return text
  const chars = [...text]
  let head = ''
  let tail = ''
  let used = 1
  for (let i = 0, j = chars.length - 1; i <= j; ) {
    const takeHead = cellWidth(head) <= cellWidth(tail)
    const char = takeHead ? (chars[i] ?? '') : (chars[j] ?? '')
    if (used + cellWidth(char) > width) break
    used += cellWidth(char)
    if (takeHead) {
      head += char
      i += 1
    } else {
      tail = char + tail
      j -= 1
    }
  }
  return `${head}…${tail}`
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
 *   ▃▆▂ 歌名 · 歌手          1:23 ━━━━●──── 3:34   b: ◀◀  p: ▮▮  n: ▶▶  o: 面板
 * 开头是跳动的均衡器（没有 Client 时是 ♪）。按钮带快捷键（迷你播放器获得焦点后按字母）。
 * 右边两段的宽度先算好，剩下的给歌名；越窄收起越多。
 */
export function MiniPlayer(kit: Kit, player: PlayerSnapshot, track: Track, columns: number, actions: MiniPlayerActions): RenderElement {
  const { Box, Text, Button, Client } = kit
  const prefixWidth = Client ? 4 : 2
  const status = player.status === 'playing' ? undefined : STATUS[player.status]
  const hasSideButtons = columns >= 70
  const elapsed = formatTime(player.position)
  const total = formatTime(player.duration)
  const barWidth = columns >= 100 ? Math.min(24, columns - 76) : 0
  const hasBar = barWidth >= 6
  const ratio = player.duration && player.duration > 0 ? Math.min(1, Math.max(0, player.position / player.duration)) : 0
  const filled = Math.min(Math.max(0, barWidth - 1), Math.round(ratio * Math.max(0, barWidth - 1)))

  const buttons: { key: string; label: string; hotkey: string; dim?: boolean; onPress: () => void }[] = [
    ...(hasSideButtons ? [{ key: 'prev', label: GLYPH.prev, hotkey: 'b', onPress: () => actions.command({ type: 'prev' }) }] : []),
    { key: 'toggle', label: player.status === 'paused' ? GLYPH.play : GLYPH.pause, hotkey: 'p', onPress: () => actions.command({ type: 'toggle' }) },
    ...(hasSideButtons ? [{ key: 'next', label: GLYPH.next, hotkey: 'n', onPress: () => actions.command({ type: 'next' }) }] : []),
    { key: 'panel', label: '面板', hotkey: 'o', dim: true, onPress: actions.openPane },
  ]
  // 带快捷键的按钮画成 `b: ◀◀`
  const buttonsWidth = buttons.reduce((sum, b) => sum + 3 + cellWidth(b.label), 0) + 2 * (buttons.length - 1)
  const timeText = hasBar ? '' : `${elapsed}/${total}`
  const timeWidth =
    (status ? cellWidth(status.text) + 1 : 0) + (hasBar ? cellWidth(elapsed) + 1 + barWidth + 1 + cellWidth(total) : cellWidth(timeText))
  const leftWidth = Math.max(8, columns - timeWidth - buttonsWidth - 5)

  const parts = titleParts(track)
  const byline = track.provider === 'bilibili' ? parts.detail : track.artists.join(' / ')
  const title = truncate(parts.title, leftWidth - prefixWidth)
  const room = leftWidth - prefixWidth - cellWidth(title)
  const bylineText = byline && room >= 6 ? truncate(` · ${byline}`, room) : ''
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box flexDirection="row" width={leftWidth} flexShrink={0}>
          {Client ? (
            <Box flexDirection="row" width={4}>
              <Client key="band-eq" module="./fx/eq.tsx" props={{ status: player.status, bars: 3 } satisfies EqProps} width={3} height={1} />
            </Box>
          ) : (
            <Text color={C.accent}>♪ </Text>
          )}
          <Text bold>{title}</Text>
          {bylineText ? <Text color={C.dim}>{bylineText}</Text> : null}
        </Box>
        <Box flexDirection="row" flexShrink={0} marginLeft={2} columnGap={1} width={timeWidth}>
          {status ? <Text color={status.color}>{status.text}</Text> : null}
          {hasBar ? (
            <Box flexDirection="row" columnGap={1}>
              <Text color={C.dim}>{elapsed}</Text>
              <Box flexDirection="row">
                <Text color={C.accent}>{'━'.repeat(filled)}</Text>
                <Text color={C.accent}>●</Text>
                <Text color={C.faint}>{'─'.repeat(barWidth - 1 - filled)}</Text>
              </Box>
              <Text color={C.dim}>{total}</Text>
            </Box>
          ) : (
            <Text color={C.dim}>{timeText}</Text>
          )}
        </Box>
        <Box flexDirection="row" flexShrink={0} marginLeft={3} columnGap={2} width={buttonsWidth}>
          {buttons.map(button => (
            <Button key={button.key} label={button.label} hotkey={button.hotkey} plain dimColor={button.dim} onPress={button.onPress} />
          ))}
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
