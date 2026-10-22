/**
 * 界面皮肤注册表（P0）
 *
 * 职责边界：
 * - 皮肤只描述**壳层**观感（顶栏 / 底栏 / 浮层 / 控件 / 卡片），不碰阅读纸面；
 *   纸面与墨色仍由主题令牌（`ThemeKey` + `night`）负责；
 * - 具体色值写在 `styles.css` 的 `[data-skin='…']` 块（首帧无 JS 也有肤色），
 *   本文件只声明元数据：名称、是否深色壳、设置面板预览色块；
 * - 皮肤键写进 localStorage 前必须过 `isUiSkinKey`，未知值一律回落默认，
 *   避免旧快照 / 手改存储把界面带进无令牌状态。
 *
 * 新增一套皮肤的顺序：本文件加键与元数据 → `styles.css` 补同名
 * `[data-skin='…']` 语义令牌块 → 设置面板自动出现（列表由 `UI_SKINS` 驱动）。
 */

/** 皮肤键（与 `styles.css` 的 `[data-skin]` 一一对应） */
export type UiSkinKey = 'paper' | 'plain' | 'ink' | 'contrast';

/** 界面密度：只缩放间距与行高，不改字号与触控目标 */
export type UiDensity = 'comfortable' | 'compact';

/** 动效偏好：auto 跟随系统，off 显式关闭 */
export type UiMotion = 'auto' | 'off';

/** 一套皮肤的元数据 */
export interface UiSkin {
  key: UiSkinKey;
  label: string;
  /** 深色壳：决定 `color-scheme` 与「选中即切夜间纸面」的联动 */
  dark: boolean;
  /** 设置面板皮肤卡的预览色块（与样式表同值） */
  preview: {
    canvas: string;
    surface: string;
    accent: string;
  };
}

/** 默认皮肤（宣纸文墨） */
export const DEFAULT_UI_SKIN: UiSkinKey = 'paper';

/** 默认密度 */
export const DEFAULT_UI_DENSITY: UiDensity = 'comfortable';

/** 默认动效偏好 */
export const DEFAULT_UI_MOTION: UiMotion = 'auto';

/**
 * 四套皮肤
 *
 * 顺序即设置面板的展示顺序：默认皮肤排第一，深色与高对比放末尾，
 * 让「绝大多数用户不需要滚动就能看到默认项」。
 */
export const UI_SKINS: readonly UiSkin[] = [
  {
    key: 'paper',
    label: '宣纸文墨',
    dark: false,
    preview: { canvas: '#efe9dd', surface: '#faf8f4', accent: '#8c5a2b' },
  },
  {
    key: 'plain',
    label: '素白现代',
    dark: false,
    preview: { canvas: '#f5f6f8', surface: '#ffffff', accent: '#3b6cf0' },
  },
  {
    key: 'ink',
    label: '墨色专注',
    dark: true,
    preview: { canvas: '#121110', surface: '#262421', accent: '#c99a5b' },
  },
  {
    key: 'contrast',
    label: '高对比',
    dark: false,
    preview: { canvas: '#ffffff', surface: '#ffffff', accent: '#0b4fd6' },
  },
];

/** 皮肤键全集（与 `UI_SKINS` 同步维护） */
export const UI_SKIN_KEYS: readonly UiSkinKey[] = UI_SKINS.map((skin) => skin.key);

/** 是否为合法皮肤键 */
export function isUiSkinKey(value: unknown): value is UiSkinKey {
  return typeof value === 'string' && (UI_SKIN_KEYS as readonly string[]).includes(value);
}

/** 是否为合法密度 */
export function isUiDensity(value: unknown): value is UiDensity {
  return value === 'comfortable' || value === 'compact';
}

/** 是否为合法动效偏好 */
export function isUiMotion(value: unknown): value is UiMotion {
  return value === 'auto' || value === 'off';
}

/**
 * 取皮肤元数据
 *
 * 未知键回落默认皮肤（调用前一般已过 `isUiSkinKey`，此处兜底存储脏数据）。
 */
export function resolveUiSkin(value: unknown): UiSkin {
  const fallback = UI_SKINS[0];
  if (!isUiSkinKey(value)) return fallback;
  return UI_SKINS.find((skin) => skin.key === value) ?? fallback;
}
