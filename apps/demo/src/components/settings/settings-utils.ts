/**
 * 设置面板纯函数工具
 *
 * 只承接「输入 → 输出」的确定性计算（主题令牌合并、页边距解析与序列化、
 * 页底溢出预设判定、令牌数值提取、色值校验），供各分区组件复用；
 * 副作用（写草稿 / 落盘）仍由各组件经 `api` 调用，本文件不持有状态。
 */
import { DEFAULT_THEME, type ThemeToken } from '@bibliotype/core';
import type { BottomSlackOptions } from '@bibliotype/layout';

/** 页边距盒（上右下左，单位 px） */
export interface MarginBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 页底溢出预设键（`custom` = 自由像素 / 未命中预设） */
export type SlackPresetKey = 'off' | 'half' | 'full' | 'custom';

/** 预设键 → 布局补丁值（`custom` 不在此表，由像素输入单独承担） */
export const SLACK_PRESET_MAP: Readonly<Record<string, BottomSlackOptions>> = {
  off: { lines: 0 },
  half: { lines: 0.5 },
  full: { lines: 1 },
};

/**
 * 主题令牌合并
 *
 * 以 `DEFAULT_THEME` 起底，只接受非空字符串覆盖（空串与非字符串一律忽略），
 * 保证色板不出现空块、也不会把「清除覆写」当成有效值写进面板基线。
 */
export function mergeTokens(
  base: Readonly<Record<string, string | undefined>> | undefined,
): Record<ThemeToken, string> {
  const merged: Record<string, string> = { ...DEFAULT_THEME };
  for (const [key, value] of Object.entries(base ?? {})) {
    if (typeof value === 'string' && value !== '') merged[key] = value;
  }
  return merged as Record<ThemeToken, string>;
}

/** 取令牌数值的字面量部分（用于 number 输入回显；无数字返回空串） */
export function extractTokenNum(raw: string | undefined): string {
  return /^-?\d+(?:\.\d+)?/.exec(raw ?? '')?.[0] ?? '';
}

/**
 * 解析页边距声明
 *
 * 与 CSS 四值简写同口径：一段全补、两段「下 = 上 / 左 = 右」，缺省回落
 * `48px 56px`（主题基线），非法段解析为 NaN 时由调用方按需处理。
 */
export function parseMarginBox(raw: string | undefined): MarginBox {
  const parts = (raw ?? '48px 56px').split(/\s+/).map((part) => Number.parseFloat(part));
  const [top = 48, right = 56, bottom = top, left = right] = parts;
  return { top, right, bottom, left };
}

/** 序列化为 CSS margin 声明（上右下左） */
export function stringifyMarginBox(box: MarginBox): string {
  return `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px`;
}

/** 当前页底溢出配置命中的预设键 */
export function resolveSlackPreset(slack: BottomSlackOptions | undefined): SlackPresetKey {
  if (slack === undefined) return 'custom';
  if (typeof slack.px === 'number') return slack.px <= 0 ? 'off' : 'custom';
  if (slack.lines === 0) return 'off';
  if (slack.lines === 0.5) return 'half';
  if (slack.lines === 1) return 'full';
  return 'custom';
}

/** 颜色令牌 → 取色器值（非法回退黑，避免取色控件收到 undefined） */
export function resolveColorValue(raw: string | undefined): string {
  const value = raw ?? '';
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
}
