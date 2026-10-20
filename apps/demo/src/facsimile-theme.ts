/**
 * 古籍仿真主题的派生规则
 *
 * 设计要点：模板的令牌与正文字体**由布局里的 `facsimile.preset` 派生**，
 * 不写入令牌补丁。因此：
 * - 切模板 = 改一个布局字段，不会在令牌补丁里留下批量覆盖；
 * - 切回「古籍直排 / 现代横排」（布局补丁清空、无 `facsimile`）时自动失效，
 *   古典视觉回到主题基准，不会残留仿真纸色 / 框色 / 字体。
 *
 * 抽成纯函数便于单测（demo 无组件挂载测试基建）。
 */
import { resolveFacsimilePreset, type LayoutOptions } from '@bibliotype/layout';
import type { FacsimilePreset } from '@bibliotype/layout';

/** 当前生效的仿真模板（未启用仿真版式 / 未知 id → undefined） */
export function resolveActiveFacsimilePreset(layout: LayoutOptions): FacsimilePreset | undefined {
  return resolveFacsimilePreset(layout.facsimile?.preset);
}

/** 模板令牌覆盖（未启用时为空对象，令牌链自然回落到主题基准） */
export function resolveFacsimilePresetTokens(
  layout: LayoutOptions,
): Readonly<Record<string, string>> {
  return resolveActiveFacsimilePreset(layout)?.tokens ?? {};
}

/** 生效正文字体令牌键：模板优先，否则回退调用方给的主题默认值 */
export function resolveActiveFontToken(layout: LayoutOptions, fallback: string): string {
  return resolveActiveFacsimilePreset(layout)?.fontToken ?? fallback;
}
