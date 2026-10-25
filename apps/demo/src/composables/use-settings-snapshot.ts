/**
 * 界面偏好快照与阅读位置持久化（localStorage）
 *
 * 三处本地存储各管一段、互不干扰：
 * - `SETTINGS_KEY`：界面偏好快照（主题 / 夜间 / 视图模式 / 翻页动效 / 属性栏折叠 /
 *   皮肤 / 密度 / 动效），启动回灌、任意变化即落盘；**不含**布局 / 令牌补丁
 *   （那部分由 use-style-settings 的样式快照按本书作用域负责）。
 * - `LAST_PAGE_KEY`：页码（锚点缺失时的回退）。
 * - `POSITION_KEY`：阅读位置锚点 JSON（改字号 / 刷新后回到原句）。
 *
 * 快照读写直接操作各块传入的源 ref（apply 赋值 / persist 收集），因此块与块之间
 * 不产生构造期循环。`hashString` / `bookIdFromTitle` 是纯函数，供 layout / edit 块
 * 推导本书设置作用域 id。
 */
import {
  DEFAULT_SCROLLBAR_STYLE,
  DEFAULT_UI_DENSITY,
  DEFAULT_UI_MOTION,
  DEFAULT_UI_SKIN,
  isScrollbarStyleKey,
  isUiDensity,
  isUiMotion,
  isUiSkinKey,
  type ScrollbarStyleKey,
  type UiDensity,
  type UiMotion,
  type UiSkinKey,
} from '../ui-skin.js';
import { host } from '../host/index.js';
import type { ThemeKey } from './use-app-themes.js';

/** 阅读位置持久化键（D5）：以锚点为主，刷新 / 改字号后回到原句（实际键经 host.storageKey 包装） */
export const POSITION_KEY = 'bibliotype-demo:position';
/** 阅读位置 localStorage 键（页码自 0 起；文档内容草稿在 IndexedDB） */
export const LAST_PAGE_KEY = 'bibliotype-demo:last-page';
/** 版式设置快照 localStorage 键（设置面板「保存设置」显式落盘，启动时回灌） */
export const SETTINGS_KEY = 'bibliotype-demo:settings';

/** PDF 导出方式（语义化字段；实现层细节不进 UI 文案） */
export type PdfExportMode = 'in-app' | 'browser-dialog';

/** 缺省导出方式：应用内直出（免打印对话框，大部头更快） */
export const DEFAULT_PDF_EXPORT_MODE: PdfExportMode = 'in-app';

/** 是否为合法导出方式（快照回灌容错） */
export function isPdfExportMode(value: unknown): value is PdfExportMode {
  return value === 'in-app' || value === 'browser-dialog';
}

/** 光栅直出清晰度档位：canvas 缩放倍率（1=96dpi 草稿 / 2=192dpi 标准 / 3=288dpi 高清 / 4=384dpi 印刷） */
export type PdfRasterScale = 1 | 2 | 3 | 4;

/** 缺省清晰度：标准 192dpi（速度与文件体积平衡） */
export const DEFAULT_PDF_RASTER_SCALE: PdfRasterScale = 2;

/** 是否为合法清晰度档位（快照回灌容错） */
export function isPdfRasterScale(value: unknown): value is PdfRasterScale {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/** 界面偏好快照：主题键 + 夜间 / 视图模式 / 翻页动效 / 属性栏折叠 / 界面皮肤 */
export interface SettingsSnapshot {
  themeKey: ThemeKey;
  night: boolean;
  viewMode: 'page' | 'scroll' | 'scroll-flow';
  pageTransition: 'slide' | 'fade' | 'none';
  /** 编辑态右栏属性检视器折叠（true = 收成细条） */
  inspectorCollapsed: boolean;
  /** 界面皮肤（壳层观感） */
  uiSkin: UiSkinKey;
  /** 界面密度 */
  uiDensity: UiDensity;
  /** 动效偏好 */
  uiMotion: UiMotion;
  /** 滚动条样式（墨线 / 卷轴 / 竹简） */
  scrollbarStyle: ScrollbarStyleKey;
  /** PDF 导出方式（「其他」分区；Electron 宿主不受影响） */
  pdfExportMode: PdfExportMode;
  /** 光栅直出清晰度档位（仅应用内直出生效） */
  pdfRasterScale: PdfRasterScale;
}

/** 字符串哈希（FNV-1a，转 36 进制）：把任意书名（含中文）映射成稳定的作用域键短串 */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** 由书名推导本书设置作用域 id（同名书复用同一份设置；标题缺失回落 'untitled'） */
export function bookIdFromTitle(title: string | undefined): string {
  const normalized = (title ?? '').trim();
  return normalized === '' ? 'untitled' : `t${hashString(normalized)}`;
}

/** 快照读写所操作的源 ref 集合 */
export interface SnapshotRefs {
  themeKey: { value: ThemeKey };
  night: { value: boolean };
  viewMode: { value: 'page' | 'scroll' | 'scroll-flow' };
  pageTransition: { value: 'slide' | 'fade' | 'none' };
  inspectorCollapsed: { value: boolean };
  uiSkin: { value: UiSkinKey };
  uiDensity: { value: UiDensity };
  uiMotion: { value: UiMotion };
  scrollbarStyle: { value: ScrollbarStyleKey };
  pdfExportMode: { value: PdfExportMode };
  pdfRasterScale: { value: PdfRasterScale };
}

/** 界面偏好快照 + 阅读位置 / 页码读写 */
export function useSettingsSnapshot(refs: SnapshotRefs) {
  /** 读取界面偏好快照（非法 / 缺失 → null，逐字段容错回退默认） */
  function readSettingsSnapshot(): SettingsSnapshot | null {
    try {
      const raw = window.localStorage.getItem(host.storageKey(SETTINGS_KEY));
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as Partial<SettingsSnapshot>;
      /* 三档主题；旧快照 / 未知值一律回落 null（再走默认主题） */
      if (
        parsed.themeKey !== 'modern' &&
        parsed.themeKey !== 'classical' &&
        parsed.themeKey !== 'facsimile'
      ) {
        return null;
      }
      const viewModeValue = parsed.viewMode;
      const transitionValue = parsed.pageTransition;
      return {
        themeKey: parsed.themeKey,
        night: parsed.night === true,
        viewMode:
          viewModeValue === 'scroll' || viewModeValue === 'scroll-flow' ? viewModeValue : 'page',
        pageTransition:
          transitionValue === 'fade' || transitionValue === 'none' ? transitionValue : 'slide',
        inspectorCollapsed: parsed.inspectorCollapsed === true,
        /* 新增字段逐项容错：旧快照没有这些键，一律回落默认 */
        uiSkin: isUiSkinKey(parsed.uiSkin) ? parsed.uiSkin : DEFAULT_UI_SKIN,
        uiDensity: isUiDensity(parsed.uiDensity) ? parsed.uiDensity : DEFAULT_UI_DENSITY,
        uiMotion: isUiMotion(parsed.uiMotion) ? parsed.uiMotion : DEFAULT_UI_MOTION,
        scrollbarStyle: isScrollbarStyleKey(parsed.scrollbarStyle)
          ? parsed.scrollbarStyle
          : DEFAULT_SCROLLBAR_STYLE,
        pdfExportMode: isPdfExportMode(parsed.pdfExportMode)
          ? parsed.pdfExportMode
          : DEFAULT_PDF_EXPORT_MODE,
        pdfRasterScale: isPdfRasterScale(parsed.pdfRasterScale)
          ? parsed.pdfRasterScale
          : DEFAULT_PDF_RASTER_SCALE,
      };
    } catch {
      return null;
    }
  }

  /**
   * 应用界面偏好快照
   *
   * 注意：**不含**布局 / 令牌补丁 —— 那部分由 `use-style-settings` 管理的
   * 样式快照负责（IndexedDB 本书作用域）。两边各存各的，避免互相覆盖。
   */
  function applySettingsSnapshot(snapshot: SettingsSnapshot): void {
    refs.themeKey.value = snapshot.themeKey;
    refs.night.value = snapshot.night;
    refs.viewMode.value = snapshot.viewMode;
    refs.pageTransition.value = snapshot.pageTransition;
    refs.inspectorCollapsed.value = snapshot.inspectorCollapsed;
    refs.uiSkin.value = snapshot.uiSkin;
    refs.uiDensity.value = snapshot.uiDensity;
    refs.uiMotion.value = snapshot.uiMotion;
    refs.scrollbarStyle.value = snapshot.scrollbarStyle;
    refs.pdfExportMode.value = snapshot.pdfExportMode;
    refs.pdfRasterScale.value = snapshot.pdfRasterScale;
  }

  /** 收集当前界面偏好并落盘 */
  function persistSettingsSnapshot(): void {
    const snapshot: SettingsSnapshot = {
      themeKey: refs.themeKey.value,
      night: refs.night.value,
      viewMode: refs.viewMode.value,
      pageTransition: refs.pageTransition.value,
      inspectorCollapsed: refs.inspectorCollapsed.value,
      uiSkin: refs.uiSkin.value,
      uiDensity: refs.uiDensity.value,
      uiMotion: refs.uiMotion.value,
      scrollbarStyle: refs.scrollbarStyle.value,
      pdfExportMode: refs.pdfExportMode.value,
      pdfRasterScale: refs.pdfRasterScale.value,
    };
    try {
      window.localStorage.setItem(host.storageKey(SETTINGS_KEY), JSON.stringify(snapshot));
    } catch {
      /* 存储不可用环境忽略 */
    }
  }

  /** 读取上次保存的页码（非法 / 不可用 → 0） */
  function readLastPage(): number {
    try {
      const raw = Number.parseInt(
        window.localStorage.getItem(host.storageKey(LAST_PAGE_KEY)) ?? '',
        10,
      );
      return Number.isFinite(raw) && raw > 0 ? raw : 0;
    } catch {
      return 0;
    }
  }

  /** 落盘当前页码（存储不可用环境静默失败） */
  function writeLastPage(pageIndex: number): void {
    try {
      window.localStorage.setItem(host.storageKey(LAST_PAGE_KEY), String(pageIndex));
    } catch {
      /* 忽略 */
    }
  }

  /** 读取上次保存的阅读位置（锚点 JSON；缺省 undefined 走旧页码回退） */
  function readSavedPosition(): string | undefined {
    try {
      const raw = window.localStorage.getItem(host.storageKey(POSITION_KEY));
      return raw === null ? undefined : raw;
    } catch {
      return undefined;
    }
  }

  /** 落盘当前阅读位置（锚点 JSON；存储不可用环境静默失败） */
  function writeSavedPosition(json: string): void {
    try {
      window.localStorage.setItem(host.storageKey(POSITION_KEY), json);
    } catch {
      /* 忽略 */
    }
  }

  return {
    readSettingsSnapshot,
    applySettingsSnapshot,
    persistSettingsSnapshot,
    readLastPage,
    writeLastPage,
    readSavedPosition,
    writeSavedPosition,
  };
}
