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
import { FONT_SIZE_TOKENS, LAYOUT_TOKENS } from '@bibliotype/core';
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

/**
 * 参与「已修改」判定的结构令牌
 *
 * 只含影响行款的四个键（字号 / 行距 / 字距 / 页边距）；纸色、框色等纯绘制
 * 令牌不参与，避免夜里切一下就误报「已修改」。
 */
const FACSIMILE_STRUCTURAL_TOKEN_KEYS: readonly string[] = [
  FONT_SIZE_TOKENS.BODY,
  LAYOUT_TOKENS.LINE_HEIGHT,
  LAYOUT_TOKENS.LETTER_SPACING,
  LAYOUT_TOKENS.PAGE_MARGIN,
];

/**
 * 当前版式是否已偏离模板基准
 *
 * 先深比较版式字段（版框 / 界行 / 版心），再比四个结构令牌；
 * 未启用仿真或模板 id 未知时返回 false（无基准可比）。
 */
export function isFacsimilePresetModified(
  layout: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
): boolean {
  const preset = resolveActiveFacsimilePreset(layout);
  const current = layout.facsimile;
  if (preset === undefined || current === undefined) return false;
  if (JSON.stringify(current) !== JSON.stringify(preset.layout.facsimile)) return true;
  return FACSIMILE_STRUCTURAL_TOKEN_KEYS.some(
    (key) => (tokens[key] ?? '') !== (preset.tokens[key] ?? ''),
  );
}
