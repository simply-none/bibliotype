/**
 * 插件注册表
 *
 * 管理插件的安装与卸载生命周期：
 * - 同名插件重复安装抛错（防静默覆盖）；
 * - 安装失败时回滚（不保留半安装状态）；
 * - uninstall 时执行插件返回的 dispose 函数。
 */
import { BIBLIOTYPE_ERROR_CODES } from '../errors/error-codes.js';
import { BibliotypeError } from '../errors/bibliotype-error.js';
import type { BibliotypeContext, BibliotypePlugin } from './types.js';

/** 插件重复安装错误 */
export class PluginConflictError extends BibliotypeError {
  constructor(name: string) {
    super(
      BIBLIOTYPE_ERROR_CODES.PLUGIN_CONFLICT,
      `插件 "${name}" 已安装。请勿重复安装同名插件。`,
      {
        details: { name },
        hint: '先 uninstall 同名插件再安装，或改用其它插件名。',
      },
    );
    this.name = 'PluginConflictError';
  }
}

/** 已安装插件记录 */
interface InstalledPlugin {
  plugin: BibliotypePlugin;
  dispose: (() => void) | undefined;
}

/** 插件注册表 */
export class PluginRegistry {
  private readonly installed = new Map<string, InstalledPlugin>();

  constructor(private readonly context: BibliotypeContext) {}

  /** 安装插件（同步；重复安装抛错，失败自动回滚） */
  install(plugin: BibliotypePlugin): void {
    if (this.installed.has(plugin.name)) {
      throw new PluginConflictError(plugin.name);
    }

    const result = plugin.install(this.context);
    const dispose: (() => void) | undefined =
      typeof result === 'function' ? result : undefined;
    this.installed.set(plugin.name, { plugin, dispose });

    this.context.events.emit('plugin:installed', {
      name: plugin.name,
      ...(plugin.version !== undefined ? { version: plugin.version } : {}),
    });
  }

  /** 批量安装（任一失败则回滚已安装项） */
  installAll(plugins: readonly BibliotypePlugin[]): void {
    const installedNames: string[] = [];
    try {
      for (const plugin of plugins) {
        this.install(plugin);
        installedNames.push(plugin.name);
      }
    } catch (error) {
      for (const name of installedNames.reverse()) {
        this.uninstall(name);
      }
      throw error;
    }
  }

  /** 卸载插件（执行 dispose 并移除记录） */
  uninstall(name: string): boolean {
    const record = this.installed.get(name);
    if (!record) return false;
    try {
      record.dispose?.();
    } finally {
      this.installed.delete(name);
    }
    return true;
  }

  /** 是否已安装 */
  has(name: string): boolean {
    return this.installed.has(name);
  }

  /** 列出已安装插件名 */
  list(): string[] {
    return [...this.installed.keys()];
  }

  /** 卸载全部插件（实例销毁时调用） */
  disposeAll(): void {
    for (const name of [...this.installed.keys()].reverse()) {
      this.uninstall(name);
    }
  }
}
