# cc-music

在 Claude Code 里听音乐。一个 Claude Code mod 加一个后台播放进程：

- `/music 晴天` 搜索并播放，`/music next`、`/music vol 40` 等控制
- 输入框上方的迷你播放器：曲名、进度、上一首 / 暂停 / 下一首按钮
- 直接对 Claude 说“放点周杰伦”，它会调用 `music` 工具帮你点歌
- 音源可插拔：目前有哔哩哔哩（默认，国内直连）和 YouTube Music

参考了 [youtube-music-cli](https://github.com/involvex/youtube-music-cli) 的 mpv 控制方式。

## 架构

```
Claude Code ── mod/（沙箱内：命令、模型工具、迷你播放器）
                 │  $.http.fetch → http://127.0.0.1:<随机端口>（带 token）
                 ▼
             daemon/（独立 Node 进程：播放队列、音源、HTTP 接口）
                 │  JSON IPC（Windows 命名管道）
                 ▼
             mpv --idle --no-video（内置 yt-dlp 取音频流）
```

mod 运行在没有 Node 的沙箱里，连不上 mpv 的命名管道，所以由 daemon 转成 HTTP。
daemon 是独立进程：mod 热重载、Claude Code 退出都不会打断音乐；多个会话共用一个播放器。
不在播放且 30 分钟没有操作时 daemon 自动退出。

## 环境要求

- Claude Code 2.1.288 及以上（支持 mods）
- Node.js 22.18 及以上（直接运行 TypeScript）
- mpv 和 yt-dlp：`scoop install mpv yt-dlp`

## 安装

```sh
npm install
```

启动 Claude Code 时加载 mod：

```sh
claude --plugin-dir "D:/Project N2/cc-music/mod"
```

或者在 `~/.claude/settings.json` 里设置后，每个会话都会加载：

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "D:/Project N2/cc-music/mod" } }
```

第一次用 `/music` 时会自动拉起 daemon。

## 用法

| 命令 | 作用 |
| --- | --- |
| `/music <歌名>` | 搜索并立即播放第一个结果（插在当前歌曲之后，原队列保留） |
| `/music bili:<歌名>`、`/music yt:<歌名>` | 指定音源 |
| `/music <序号>` | 播放上次搜索结果里的第几首 |
| `/music add <歌名\|序号\|all>` | 加到队列末尾 |
| `/music search <歌名>` | 只搜索 |
| `/music pause` / `resume` / `toggle` / `next` / `prev` / `stop` | 播放控制 |
| `/music vol <0-100\|+10\|-10>` | 音量 |
| `/music seek <1:30\|+10\|-10>` | 跳转 |
| `/music repeat <off\|all\|one>` | 循环模式 |
| `/music queue` / `jump <n>` / `remove <n>` / `clear` | 队列 |
| `/music show` / `hide` | 显示 / 隐藏迷你播放器 |
| `/music providers` | 查看音源 |
| `/music quit` | 关闭后台播放器 |

迷你播放器获得焦点（ctrl+x tab）后，`b` / `p` / `n` 分别是上一首 / 暂停 / 下一首。

## 配置

`~/.cc-music/config.json`（第一次启动时生成）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `defaultProvider` | `bilibili` | 不带前缀搜索时用的音源 |
| `volume` | `60` | 启动音量 |
| `mpvPath` / `ytdlpPath` | 自动 | 找不到时手动指定 |
| `jsRuntime` | `node` | 交给 yt-dlp `--js-runtimes`，解析 YouTube 需要 |
| `cookiesFromBrowser` | 空 | 交给 yt-dlp `--cookies-from-browser`，如 `firefox` |
| `cookiesFile` | 空 | 交给 yt-dlp `--cookies` 的 cookies.txt |
| `idleExitMinutes` | `30` | 空闲多久自动退出，0 表示不退出 |

改完配置后 `/music quit` 再重新播放即可生效。日志在 `~/.cc-music/daemon.log`。

### YouTube Music 播放被拦截

YouTube 会对部分网络出口（尤其是代理）要求“确认你不是机器人”，这时搜索正常但播放失败。
解决办法是给 yt-dlp 提供登录过 YouTube 的 cookies：

- 用浏览器扩展（如 Get cookies.txt LOCALLY）导出 `cookies.txt`，在配置里设置 `cookiesFile`
- 或者设置 `cookiesFromBrowser`（Windows 上 Chrome / Edge 的 cookies 加密后 yt-dlp 常常读不出，Firefox 更可靠）
- 或者换一个代理节点

## 新增音源

在 `daemon/src/providers/` 下实现 `MusicProvider`（`search` 和 `streamUrl`），在 `providers/index.ts` 注册即可。
`streamUrl` 返回 mpv 能打开的地址，网页地址会经 yt-dlp 解析，所以 yt-dlp 支持的网站基本都能接。
mod 不需要改：`/music <别名>:` 前缀和模型工具都从 daemon 读音源列表。

## 开发

```sh
npm run check      # daemon 和 mod 的类型检查、mod 校验、mod 测试
npm run daemon     # 前台运行 daemon（调试用）
```

- `mod/tsconfig.json` 继承 Claude Code 生成的 `mod/.claude-plugin/types/tsconfig.json`；刚检出时先运行一次 `npm test` 或 `claude --plugin-dir mod` 生成它
- mod 的约束：`$` 只能在 hook 里直接调用，不能传给其他函数，所以 `register.tsx` 在 `session.start` 里把能力包成 `Host`（见 `hooks/host.ts`）；`$.state` 的 atom 必须声明在使用它的文件里
- 在 Git Bash 里运行 `claude -p "/music ..."` 时先 `export MSYS_NO_PATHCONV=1`，否则 `/music` 会被改写成 Windows 路径
