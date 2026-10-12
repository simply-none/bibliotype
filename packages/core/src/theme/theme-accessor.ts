/**
 * 主题访问器实现
 *
 * 对应 plugin/types.ts 中的 ThemeAccessor 接口：
 * - 以默认主题为基线，支持逐令牌覆盖；
 * - set 返回还原函数（符合 dispose 惯用法）；
 * - all 返回快照，外部无法绕过 setter 修改。
 */
import type { ThemeAccessor } from '../plugin/types.js';
import { DEFAULT_THEME } from './default-theme.js';
import type { ThemeToken } from './tokens.js';

/** 创建主题访问器 */
export function createThemeAccessor(
  overrides?: Partial<Record<ThemeToken, string>>,
): ThemeAccessor {
  const tokens = new Map<string, string>(Object.entries(DEFAULT_THEME));
  if (overrides) {
    for (const [token, value] of Object.entries(overrides)) {
      if (value !== undefined) tokens.set(token, value);
    }
  }

  return {
    get(token: string): string | undefined {
      return tokens.get(token);
    },

    set(token: string, value: string): () => void {
      const previous = tokens.get(token);
      tokens.set(token, value);
      return () => {
        if (previous === undefined) {
          tokens.delete(token);
        } else {
          tokens.set(token, previous);
        }
      };
    },

    all(): Readonly<Record<string, string>> {
      return Object.fromEntries(tokens);
    },
  };
}
