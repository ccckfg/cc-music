import type { Config } from '../config.ts'
import type { ProviderInfo } from '../protocol.ts'
import { BilibiliProvider } from './bilibili.ts'
import type { MusicProvider } from './types.ts'
import { YouTubeMusicProvider } from './ytmusic.ts'

/** 所有音源的登记处：按 id 或别名查找，决定默认音源。 */
export class ProviderRegistry {
  private readonly providers: MusicProvider[]
  private readonly config: Config

  constructor(config: Config) {
    this.config = config
    this.providers = [new BilibiliProvider(), new YouTubeMusicProvider(config)]
  }

  /** 默认音源跟着配置走：设置页改了立即生效 */
  private get defaultId(): string {
    return this.find(this.config.defaultProvider)?.id ?? this.providers[0]?.id ?? ''
  }

  /** 按 id 或别名找音源，大小写不敏感。 */
  find(idOrAlias: string): MusicProvider | undefined {
    const key = idOrAlias.toLowerCase()
    return this.providers.find(provider => provider.id === key || provider.aliases.includes(key))
  }

  /** 找不到时抛错，错误信息列出可用的音源。 */
  get(idOrAlias: string | undefined): MusicProvider {
    const provider = this.find(idOrAlias ?? this.defaultId)
    if (provider) return provider
    const known = this.providers.map(p => `${p.id}（${p.aliases.join('/')}）`).join('、')
    throw new Error(`没有音源 “${idOrAlias}”，可用：${known}`)
  }

  list(): ProviderInfo[] {
    return this.providers.map(provider => {
      const info: ProviderInfo = {
        id: provider.id,
        name: provider.name,
        aliases: [...provider.aliases],
        isDefault: provider.id === this.defaultId,
      }
      const note = provider.note()
      if (note) info.note = note
      return info
    })
  }
}
