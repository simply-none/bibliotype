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

/**
 * 滚动条样式键（与 `styles/scrollbars.css` 的 `[data-scrollbar]` 一一对应）
 *
 * 只改滚动条观感（粗细 / 轨槽 / 滑块纹理），不碰正文纸色与壳层色板。
 */
export type ScrollbarStyleKey = 'ink' | 'scroll' | 'bamboo';

/** 一套滚动条样式的元数据 */
export interface ScrollbarStyle {
  key: ScrollbarStyleKey;
  label: string;
  /** 设置面板里的一句话说明（用户语言，不出现实现词） */
  description: string;
  /** 设置面板预览条：尺寸与配色（与样式表同值） */
  preview: {
    size: number;
    track: string;
    thumb: string;
    radius: string;
  };
}

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

/** 默认滚动条样式（墨线：最不抢正文的细线） */
export const DEFAULT_SCROLLBAR_STYLE: ScrollbarStyleKey = 'ink';

/**
 * 三套滚动条样式
 *
 * 顺序即展示顺序：默认项排第一。颜色与 `styles/scrollbars.css` 的令牌块同值，
 * 供设置面板的迷你预览条直接复用（不必真的渲染一个可滚容器）。
 */
export const SCROLLBAR_STYLES: readonly ScrollbarStyle[] = [
  {
    key: 'ink',
    label: '墨线',
    description: '极细的墨色滑块，安静贴边、不抢正文，日常阅读推荐。',
    preview: { size: 8, track: 'transparent', thumb: 'rgb(60 58 52 / 35%)', radius: '999px' },
  },
  {
    key: 'scroll',
    label: '卷轴',
    description: '檀木轴杆配浅色轨槽，像卷轴两端的轴头，横竖滚动都沉稳。',
    preview: { size: 12, track: '#e8e1d3', thumb: '#8c5a2b', radius: '3px' },
  },
  {
    key: 'bamboo',
    label: '竹简',
    description: '竹节纹理轨槽配深竹色滑块，呼应竖排简牍的书卷气。',
    preview: { size: 12, track: '#e3e8dd', thumb: '#6b8f5e', radius: '4px' },
  },
];

/** 滚动条样式键全集（与 `SCROLLBAR_STYLES` 同步维护） */
export const SCROLLBAR_STYLE_KEYS: readonly ScrollbarStyleKey[] = SCROLLBAR_STYLES.map(
  (style) => style.key,
);

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

/** 是否为合法滚动条样式键 */
export function isScrollbarStyleKey(value: unknown): value is ScrollbarStyleKey {
  return typeof value === 'string' && (SCROLLBAR_STYLE_KEYS as readonly string[]).includes(value);
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
