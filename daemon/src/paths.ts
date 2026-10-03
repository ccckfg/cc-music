import { homedir } from 'node:os'
import { join } from 'node:path'

/** cc-music 的数据目录：配置、daemon 信息、日志都在这里。 */
export const DATA_DIR = process.env['CC_MUSIC_HOME'] ?? join(homedir(), '.cc-music')

export const CONFIG_FILE = join(DATA_DIR, 'config.json')
export const DAEMON_FILE = join(DATA_DIR, 'daemon.json')
export const LOG_FILE = join(DATA_DIR, 'daemon.log')

export const VERSION = '0.1.0'
