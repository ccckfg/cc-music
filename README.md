# cc-music

**在 Claude Code 里听音乐，不用离开终端。**

输入 `/music 晴天 周杰伦` 点歌，或者直接说“放点适合写代码的歌”。音乐在后台播放，你可以继续让 Claude 写代码。

![Claude Code 对话区、迷你播放器和 cc-music 侧边栏](docs/images/player.svg)

上图是按真实界面渲染结果绘制的 SVG 示意图，歌曲、歌词、封面和对话使用演示数据，不是真实播放截图。SVG 包含动画；实际显示效果取决于终端字体、窗口大小和主题。

## 能做什么

- **点歌与控制**：搜索、播放、暂停、切歌、跳转、音量、循环播放。
- **侧边栏播放器**：块字符封面、跳动的音符、频谱风格动画、进度条和随播放推进的歌词染色。
- **迷你播放器**：输入框上方显示当前曲目和进度，不打开面板也能控制。
- **整理歌单**：播放队列、收藏、播放历史；搜到的歌可以立即播放或加到队尾。
- **自然语言点歌**：Claude 可以调用插件的 `music` 工具，不用记住所有命令。
- **两个音源**：默认使用哔哩哔哩，也支持 YouTube Music。音源可以扩展。

播放器是独立后台进程。Claude Code 退出、插件热重载不会打断音乐，多个会话共用一个播放器。默认在**未播放且 30 分钟没有操作**时自动退出；立即关闭用 `/music quit`。

## 安装

### 1. 准备运行环境

| 软件 | 要求 | 用途 |
| --- | --- | --- |
| Claude Code | **2.1.288 或更新版本**，支持 mods | 加载命令、工具和播放器界面 |
| Node.js | **22.18 或更新版本** | 运行后台播放器 |
| mpv | 可从终端调用 | 实际播放音频 |
| yt-dlp | 可从终端调用，建议保持最新 | 从音源页面解析音频 |
| ffmpeg | 可选，推荐安装 | 把封面转换为终端可显示的像素 |

目前主要在 **Windows** 上开发和测试，macOS / Linux 尚未完整验证。

如果你已经安装了 [Scoop](https://scoop.sh/)，在 PowerShell 中运行：

```powershell
scoop install mpv yt-dlp ffmpeg
# 还没有满足版本要求的 Node.js 时，再安装：
scoop install nodejs-lts
```

也可以自行安装这些软件并加入 `PATH`。安装后重新打开终端，确认 `claude --version`、`node --version`、`mpv --version` 和 `yt-dlp --version` 能正常运行。

### 2. 从插件市场安装（推荐）

在 Claude Code 的输入框里，依次执行：

```text
/plugin marketplace add ccckfg/cc-music
/plugin install cc-music@cc-music
```

第一个命令添加本项目的插件市场，第二个安装播放器。仓库本身就是插件，界面和后台会一起安装，符合要求的 npm 依赖由 Claude Code 自动安装。

安装完成后重新打开 Claude Code 会话。如果出现插件权限提示，核对内容后授权加载。然后输入：

```text
/music 晴天 周杰伦
```

第一次使用会自动启动后台播放器，冷启动可能需要十几秒。默认搜索哔哩哔哩，不需要另建播放器账号。

> 插件市场不会替你安装 Node.js、mpv、yt-dlp 或 ffmpeg。它们仍需要先准备好。

### 备选：让 agent 帮你安装

把下面这句话发给有终端权限的 Claude Code 或其他 coding agent：

```text
请帮我安装 https://github.com/ccckfg/cc-music：先检查 Claude Code 是否支持 mods、Node.js 是否 >= 22.18，以及 mpv、yt-dlp、ffmpeg 是否可用；缺少软件时先告诉我并征求确认。优先通过 Claude Code 插件市场添加 ccckfg/cc-music，安装 cc-music@cc-music，不要覆盖我已有的配置。装完告诉我需要重新打开会话，并用 /music 验证插件能加载，不要自动播放音乐。
```

### 从源码加载（开发或临时体验）

在终端中执行：

```sh
git clone https://github.com/ccckfg/cc-music.git
cd cc-music
npm ci
claude --plugin-dir .
```

这里的 `.` 是**仓库根目录**，不是 `mod/`。`--plugin-dir` 只对这次启动生效，日常使用推荐插件市场安装。

## 开始使用

### 点歌

```text
/music 晴天 周杰伦
/music bili:稻香 周杰伦
/music yt:Yellow Coldplay
```

会播放第一个搜索结果。写“歌名 歌手”通常比只写歌名更准确；B 站结果可能是 MV、现场或翻唱，以搜索结果为准。

想先挑选，再播放：

```text
/music search 晴天 周杰伦
/music 2
```

序号对应**本会话最近一次搜索**。直接点歌会把新歌插在当前歌曲之后并立即切过去，原队列保留。

也可以直接对 Claude 说：

```text
放点周杰伦的歌。
把稻香加入队列。
下一首，音量调到 40。
现在放的是什么？帮我收藏。
```

### 打开面板

输入 `/music` 打开面板，点击图标切换**正在播放、搜索、队列、收藏、历史、设置**。

![cc-music 的搜索、队列和设置页](docs/images/panels.svg)

- 点击歌名立即播放，点 `+` 加到队尾，队列里点 `×` 移除。
- 点击或拖动进度条跳转，点击或拖动音量条调整音量。
- 点播放键暂停 / 继续，点心形收藏，点循环图标切换模式。
- 用 Tab 在可聚焦控件间移动，回车触发。标签栏、播放控制和音量条获得焦点后支持方向键；播放控制支持空格暂停。
- 迷你播放器获得焦点后，`b` / `p` / `n` / `o` 分别是上一首 / 暂停 / 下一首 / 打开面板。焦点切换用 `Ctrl+X`，再按 Tab。

**面板不在右侧？** 默认全屏布局下，终端宽度至少 110 列才会停靠成侧边栏；否则显示在输入框上方。`CLAUDE_CODE_NO_FLICKER=0` 或 tmux 的主屏幕布局也会影响位置。全屏布局下点歌会自动打开面板，可以在设置页关闭。

封面使用终端块字符，不依赖终端图片协议。适当拉宽侧边栏、增加终端高度，效果会更清楚。

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `/music` | 打开播放器面板 |
| `/music <歌名>` | 搜索并播放第一个结果 |
| `/music search <歌名>`、`/music <序号>` | 搜索候选、播放其中一首 |
| `/music add <歌名\|序号\|all>` | 加入队尾；`all` 加入最近搜索的全部结果 |
| `/music pause` / `resume` / `toggle` | 暂停 / 继续 / 切换 |
| `/music next` / `prev` / `stop` | 下一首 / 上一首 / 停止播放 |
| `/music vol 40`、`/music vol +10` | 设置音量，或相对调整（0–100） |
| `/music seek 1:30`、`/music seek +10` | 跳到指定时间，或相对跳转（秒） |
| `/music repeat off` / `all` / `one` | 不循环 / 队列循环 / 单曲循环 |
| `/music queue`、`jump <n>`、`remove <n>`、`clear` | 查看、跳转、移除、清空队列；后面三个也要加 `/music` |
| `/music lyrics` | 查看当前歌词 |
| `/music fav` / `favs` / `history` | 收藏或取消收藏当前歌 / 查看收藏 / 历史 |
| `/music show` / `hide` | 显示 / 隐藏迷你播放器，偏好会保存 |
| `/music providers` / `status` | 查看音源 / 当前状态 |
| `/music restart` | 重启后台，保留队列和进度；升级后使用 |
| `/music quit` | 关闭后台播放器和 mpv |

## 设置

点击面板标签栏最右边的 **⚙**：

- **播放**：默认音源、启动音量。启动音量在下一次后台启动时生效。
- **界面**：迷你播放器、点歌时自动打开侧边栏、封面开关。偏好保存在 Claude Code 的插件存储中。
- **YouTube Music**：填写 cookies 文件的完整路径，回车保存，并检查文件是否存在。
- **后台播放器**：空闲退出时间、依赖检测、重启按钮、配置文件位置。退出时间设为 0 表示不自动退出。

后台配置保存在 `~/.cc-music/config.json`，首次启动自动生成。Windows 的 `~` 通常是 `C:\Users\<用户名>`。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `defaultProvider` | `bilibili` | 默认搜索音源，也可设为 `ytmusic` |
| `volume` | `60` | 启动音量 |
| `mpvPath` / `ytdlpPath` / `ffmpegPath` | 自动查找 | 需要时填写可执行文件完整路径 |
| `jsRuntime` | `node` | yt-dlp 的 JavaScript 运行时，用于 YouTube 解析 |
| `cookiesFile` | 空 | 导出的 cookies.txt 路径 |
| `cookiesFromBrowser` | 空 | yt-dlp 的浏览器 cookies 来源，例如 `firefox` |
| `idleExitMinutes` | `30` | 未播放时的空闲退出时间，0 禁用 |

设置页的后台配置修改会立即应用（启动音量除外）；手动改文件后执行 `/music restart`。收藏和历史在 `~/.cc-music/library.json`，日志在 `~/.cc-music/daemon.log`。

高级环境变量：`CC_MUSIC_HOME` 覆盖数据目录，`CC_MUSIC_NODE` 指定 Node.js，`CC_MUSIC_DAEMON` 指定 `daemon/src/launch.ts`。通常不需要设置。

## 常见问题

**没有 `/music` 命令，或安装后没出现界面**

先确认 Claude Code 版本支持 mods，在 `/plugin` 中检查 cc-music 是否启用，再重新打开会话。组织策略也可能禁止 mods，普通插件能加载不代表 mod 被允许。

**找不到 mpv / yt-dlp，或后台启动失败**

安装后重新打开终端，确认它们在 `PATH` 中；也可以在配置里指定完整路径。查看设置页的依赖检测和 `daemon.log`。日志可能包含本地路径，反馈问题前请检查并移除敏感信息，不要上传 cookies、token 或整个数据目录。

**YouTube 能搜到，但播放提示“确认你不是机器人”**

搜索和播放走不同的接口。YouTube 可能要求当前网络出口完成验证，尤其是使用代理时：

1. 在浏览器登录 YouTube，通过可信扩展导出 `cookies.txt`。
2. 在设置页填写文件的完整路径，回车保存，再执行 `/music restart`。
3. 也可以设置 `cookiesFromBrowser` 为 `firefox`，或更换网络出口。Windows 上 Chrome / Edge 的 cookies 加密可能导致 yt-dlp 无法读取。

cookies 相当于登录凭据，只保存在本机，不要提交到 Git、发给 agent 或上传到 issue。提供 cookies 也不保证所有地区限制或验证都能绕过。

**没有封面、歌词，或歌词版本不对**

封面需要 ffmpeg 和音源提供的缩略图。歌词来自 [LRCLIB](https://lrclib.net)，并非每首歌都有；现场、翻唱、纯音乐可能无歌词或匹配到其他版本。B 站标题会清理标签、提取《歌名》，再按时长挑选结果。

**界面的频谱是真实音频分析吗？**

不是。它是播放状态驱动的频谱风格动画，没有采样音频或做 FFT 分析。

**更新和卸载**

用 `/plugin marketplace update cc-music` 刷新市场，再到 `/plugin` 的已安装列表更新 cc-music。按 Claude Code 的提示重新加载或重新打开会话，然后 `/music restart`，让正在运行的后台也使用新版。

卸载前先 `/music quit`，再执行 `/plugin uninstall cc-music@cc-music`。卸载插件不会自动删除 `~/.cc-music` 中的配置、收藏和历史。

## 开发与扩展

```text
cc-music/
├─ .claude-plugin/   插件清单、市场清单、Claude Code 生成的类型
├─ hooks/            命令、模型工具、状态、面板与迷你播放器
│  └─ fx/            绘制线程上的动画和鼠标交互控件
├─ daemon/src/       本机 HTTP 接口、队列、配置和 mpv IPC
│  ├─ providers/     哔哩哔哩、YouTube Music 音源
│  └─ lyrics/        歌词来源
├─ types/            插件端的数据类型
├─ tests/            Claude Code 插件测试
└─ docs/images/      README 的 SVG 展示图
```

数据流：Claude Code mod → 带随机 token 的本机 HTTP 接口 → daemon → mpv JSON IPC → yt-dlp 解析音源。HTTP 只监听 `127.0.0.1`；Windows 使用命名管道，其他平台使用 Unix socket。

```sh
npm ci
npm test             # 加载插件并运行测试，首次生成 Claude Code 类型
npm run check        # daemon + 插件类型检查、清单校验、插件测试
npm run daemon       # 前台运行后台播放器，调试用
```

`tsconfig.json` 继承 Claude Code 生成的 `.claude-plugin/types/tsconfig.json`。如果类型没有写入源码目录，先从该目录运行一次 `claude --plugin-dir .`，再运行检查。生成的类型不提交到 Git。

开发时用 `claude --plugin-dir .`，修改会热重载。不要在 Windows 上用 junction 链到会话的 mods 目录，热重载可能监视不到真实文件的变化。

- 新增音源：实现 `daemon/src/providers/types.ts` 中的 `MusicProvider`，在 `providers/index.ts` 注册。
- 新增歌词来源：实现 `daemon/src/lyrics/types.ts` 中的 `LyricsProvider`，在 `lyrics/index.ts` 注册。
- 面板绘制在 `hooks/view.tsx`，宿主调用和事件注册在 `hooks/register.tsx`；不要把沙箱的 `$` 传给普通函数。

播放控制方式参考了 [youtube-music-cli](https://github.com/involvex/youtube-music-cli)。请遵守音源平台的使用条款；本项目不提供音乐文件，也不保证所有搜索结果始终可播放。
