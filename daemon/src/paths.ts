import { homedir } from 'node:os'
import { join } from 'node:path'

/** cc-music 的数据目录：配置、daemon 信息、日志都在这里。 */
export const DATA_DIR = process.env['CC_MUSIC_HOME'] ?? join(homedir(), '.cc-music')

export const CONFIG_FILE = join(DATA_DIR, 'config.json')
export const DAEMON_FILE = join(DATA_DIR, 'daemon.json')
export const LOG_FILE = join(DATA_DIR, 'daemon.log')
/** daemon 每次启动时记下自己的位置，插件被拷到别处时靠它找到 launch.ts */
export const INSTALL_FILE = join(DATA_DIR, 'install.json')

export const VERSION = '0.4.0'
