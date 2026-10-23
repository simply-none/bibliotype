/**
 * 版式补丁与令牌层（设置面板覆写主题基准）
 *
 * 样式设置（三级作用域 + 自动持久化）由 `useStyleSettings` 统一管理：布局补丁 /
 * 令牌补丁 / 功能样式 / 命名样式 / 编辑行为，草稿模式（弹窗内改草稿、保存才生效）。
 *
 * 生效层 = 主题基准 → 窄屏适配缺省 → 用户补丁 →（按舞台折算开本适配）；
 * 面板视图（panelLayout / panelTokens）把补丁换成草稿且不折算，避免「点了不高亮」。
 *
 * 开本适配（`pageSizeMode`）在此层落地：声明层只记「用户想要哪种取法」，真正的
 * `pageSize` / `columns` 由 `applyPageSizeMode` 按舞台实测盒折算；折算结果改变了
 * 度量签名里的页宽页高 → 预览 / 编辑画布 / 导出都自动跟着重量尺重排。
 *
 * 跨块回调（重排调度 / 界面偏好落盘）经参数注入，由 App.vue 晚绑定，
 * 破除 layout → reader / snapshot 的构造期循环。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { FONT_SIZE_TOKENS, LAYOUT_TOKENS } from '@bibliotype/core';
import {
  PAGE_SIZE_MODES,
  applyPageSizeMode,
  resolvePageFitScale,
  isVerticalMode,
  mergeLayoutOptions,
  type LayoutOptions,
  type StageBoxSize,
} from '@bibliotype/layout';
import {
  resolveActiveFacsimilePreset,
  resolveActiveFontToken,
  resolveFacsimilePresetTokens,
} from '../facsimile-theme.js';
import { useStyleSettings, type StyleSettingsApi } from './use-style-settings.js';
import { bookIdFromTitle } from './use-settings-snapshot.js';
import { lunyuDocument } from '../data/lunyu.js';
import { NIGHT_COLORS, type ThemeConfig } from './use-app-themes.js';

/** 《论语》样本书的固定 id（启动默认书） */
export const LUNYU_BOOK_ID = bookIdFromTitle(lunyuDocument.metadata.title);

/** 解析令牌前导数值（非法回退默认） */
export function parseTokenNum(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface LayoutTokensDeps {
  theme: ComputedRef<ThemeConfig>;
  night: Ref<boolean>;
  mobileShell: ComputedRef<boolean>;
  /** 舞台实测可用尺寸（px，已扣内边距）；null = 尚未量到 */
  stageSize: Ref<StageBoxSize | null>;
  /** 去抖重排（晚绑定到 reader 块） */
  scheduleRemeasure: () => void;
  /** 界面偏好落盘（晚绑定到 snapshot 块） */
  persistSnapshot: () => void;
}

/** 版式 / 令牌 / 样式作用域中枢 */
export function useLayoutTokens(deps: LayoutTokensDeps) {
  const { theme, night, mobileShell, stageSize } = deps;

  /** 当前书籍 id（响应式）：切书后样式设置随之切到该书作用域并重新载入应用 */
  const currentBookId = ref(LUNYU_BOOK_ID);

  const styleApi: StyleSettingsApi = useStyleSettings({ bookId: currentBookId, draft: true });

  /** 布局补丁（含页面尺寸；主题切换时清空） */
  const layoutPatch = styleApi.layoutPatch as Ref<Partial<LayoutOptions>>;
  /** 令牌补丁（字号 / 行距 / 字体族 / 版式 / 颜色等） */
  const tokenPatch = styleApi.tokenPatch;
  /** 功能样式表（按功能粒度的样式覆盖） */
  const features = styleApi.features;
  /** 命名样式集合 */
  const namedStyles = styleApi.namedStyles;
  /** 编辑行为设置 */
  const editing = styleApi.editing;

  /**
   * 窄屏适配缺省（A2）：用户未在本套补丁里选过适配时，H5 壳缺省走 `h5` 取形
   *
   * 不再无条件压缩页宽（那会推翻用户显式选的「固定 / 自适应」，造成「选了不生效」），
   * 它只是一层缺省值：主题基准 → 本缺省 → 用户补丁，选过一次就完全听用户的，
   * 且随样式快照落盘（换回宽视口也不会被悄悄改掉）。
   */
  function shellModePatch(patch: Partial<LayoutOptions>): Partial<LayoutOptions> {
    if (!mobileShell.value || patch.pageSizeMode !== undefined) return {};
    return { pageSizeMode: PAGE_SIZE_MODES.H5 };
  }

  /**
   * 声明层布局：主题基准 + 窄屏缺省 + 用户补丁（尚未按舞台折算）
   *
   * 面板回显用的是本层：开本下拉得按用户选的预设回显，不能被 `h5` 折算出的
   * 340×舞台高临时页型顶成「自定义」（`width` / `height` 本就折不动几何）。
   */
  const declaredLayout = computed<LayoutOptions>(() =>
    mergeLayoutOptions(
      mergeLayoutOptions(theme.value.layout, shellModePatch(layoutPatch.value)),
      layoutPatch.value,
    ),
  );

  /**
   * 生效布局：声明层按开本适配折算成真实页型
   *
   * 只有 `h5` 会动几何（340 页宽 + 单栏，页高铺舞台）；`fixed`（缺省）原样返回；
   * `width` / `height` 是视图缩放档，页框保持开本、不重排（倍率见 fitScale）。
   * 量不到舞台时一律原样返回，不凭臆造值重排。
   */
  const effectiveLayout = computed<LayoutOptions>(() =>
    applyPageSizeMode(declaredLayout.value, stageSize.value ?? undefined),
  );

  /**
   * 整页视图缩放倍率（PDF「适合宽度 / 高度」语义）
   *
   * `width` / `height` 档按「舞台实测轴 / 开本同名轴」算倍率（允许 >1 放大，
   * 字体与版面整体等比缩放）；其余档位 / 仿真版式 / 量不到时为 `undefined` =
   * 不覆盖，视图按自身 contain 适配。宿主把它同时交给阅读视图（fitScale prop）
   * 与编辑画布（scale）；几何不动 → 不触发重量尺，拖动窗口只是重新缩放。
   */
  const fitScale = computed<number | undefined>(() =>
    resolvePageFitScale(effectiveLayout.value, stageSize.value ?? undefined),
  );

  /** 当前仿真模板（由 `layout.facsimile.preset` 派生；未启用仿真版式时为 undefined） */
  const facsimilePreset = computed(() => resolveActiveFacsimilePreset(effectiveLayout.value));

  /** 仿真模板令牌覆盖：只派生、不写入令牌补丁（切主题即消失，不污染古典） */
  const facsimilePresetTokens = computed<Readonly<Record<string, string>>>(() =>
    resolveFacsimilePresetTokens(effectiveLayout.value),
  );

  /** 生效正文字体令牌键：仿真模板优先，其余仍取主题默认 */
  const activeFontToken = computed(() =>
    resolveActiveFontToken(effectiveLayout.value, theme.value.fontToken),
  );

  /**
   * 界面外壳是否转为「左侧竖向设置列」（直排 = 顶栏 / 工具条三行 / 状态栏
   * 整体旋 90° 成五条通高竖列；属性栏为附加列）。见 App.vue 顶部说明。
   */
  const verticalRail = computed(() => isVerticalMode(effectiveLayout.value.writingMode));

  /**
   * 直排竖列是否生效（A1）：五条通高竖列吃横向空间，窄屏摆不下；
   * H5 一律按横排摆位渲染 chrome。书写方向本身仍由主题决定，正文不受影响。
   */
  const railLayout = computed(() => verticalRail.value && !mobileShell.value);

  /**
   * 主题预设令牌（D10，仅由「外观主题」面板写入）
   *
   * 与样式快照（layout / features / namedStyles / tokenPatch）分开存放：
   * 主题只管纸色与墨色，样式预设只管排版，二者叠在不同层，互不覆盖。
   */
  const themePresetTokens = ref<Record<string, string>>({});

  /** 主题基线：切换主题 / 仿真模板后的「出厂色」，作为主题预设的重置目标 */
  const themeBaseTokens = computed<Readonly<Record<string, string | undefined>>>(() => ({
    ...theme.value.tokens,
    ...facsimilePresetTokens.value,
  }));

  /**
   * 当前生效令牌：主题基础 → 仿真模板 → 用户补丁 → 主题预设 → 夜间覆盖
   *
   * 层序理由：仿真模板是「版式基准」，用户单点微调优先于它；主题预设代表用户
   * 显式选择的外观，压在用户补丁之上；夜间是临时预览，永远压在最上层。
   */
  const tokens = computed<Readonly<Record<string, string | undefined>>>(() => ({
    ...theme.value.tokens,
    ...facsimilePresetTokens.value,
    ...tokenPatch.value,
    ...themePresetTokens.value,
    ...(night.value ? NIGHT_COLORS : {}),
  }));

  /**
   * 设置弹窗专用视图：在声明层上换成草稿补丁
   *
   * 弹窗内的点选先进草稿（不重排画布），选中态却读的是生效层会导致「点了不高亮」；
   * 这里把布局 / 令牌切到面板视图（草稿模式 = 草稿），画布仍用 effectiveLayout / tokens。
   * 与生效层同构但**不做几何折算**：面板只展示并编辑「用户声明」的开本与适配档位。
   */
  const panelLayout = computed<LayoutOptions>(() => {
    const draft = styleApi.panelLayoutPatch.value as Partial<LayoutOptions>;
    return mergeLayoutOptions(
      mergeLayoutOptions(theme.value.layout, shellModePatch(draft)),
      draft,
    );
  });

  const panelTokens = computed<Readonly<Record<string, string | undefined>>>(() => ({
    ...theme.value.tokens,
    ...resolveFacsimilePresetTokens(panelLayout.value),
    ...styleApi.panelTokenPatch.value,
    ...themePresetTokens.value,
    ...(night.value ? NIGHT_COLORS : {}),
  }));

  /**
   * 应用主题预设（来自「外观主题」面板）：只保留与基线的差量，既避免把默认值
   * 写死成补丁，也让「恢复默认」自然退化为空差量。应用主题时顺手关掉夜间覆盖。
   *
   * @param next 面板计算出的全量令牌
   */
  function onApplyThemeTokens(next: Record<string, string>): void {
    night.value = false;
    const patch: Record<string, string> = {};
    for (const [key, value] of Object.entries(next)) {
      if (value !== themeBaseTokens.value[key]) patch[key] = value;
    }
    themePresetTokens.value = patch;
  }

  /** 正文字号（px，tokens 视觉 + measure 估算双通道联动） */
  const fontSizeNum = computed(() =>
    parseTokenNum(tokens.value[FONT_SIZE_TOKENS.BODY], 16),
  );

  /**
   * 双指缩放回调：写回令牌补丁并重排
   *
   * 组件只上抛字号，重排（重新量尺）由宿主负责 —— 与设置面板字号滑杆同一条通道。
   */
  function onFontSizeUpdate(next: number): void {
    const clamped = Math.min(32, Math.max(12, Math.round(next)));
    tokenPatch.value = { ...tokenPatch.value, [FONT_SIZE_TOKENS.BODY]: `${clamped}px` };
    deps.scheduleRemeasure();
  }

  /** 正文行高（可连续调节） */
  const lineHeightNum = computed(() =>
    parseTokenNum(tokens.value[LAYOUT_TOKENS.LINE_HEIGHT], 1.9),
  );

  /** 是否存在任何覆写（夜间预设 / 布局补丁 / 令牌补丁 / 功能样式） */
  const customized = computed(
    () =>
      night.value ||
      styleApi.customized.value ||
      Object.keys(layoutPatch.value).length > 0,
  );

  /** 恢复全部默认：清空补丁 / 功能样式 / 命名样式 / 夜间 / 主题预设，并删除已存样式快照 */
  async function resetSettings(): Promise<void> {
    night.value = false;
    themePresetTokens.value = {};
    await styleApi.resetAll();
    deps.persistSnapshot();
  }

  return {
    currentBookId,
    styleApi,
    layoutPatch,
    tokenPatch,
    features,
    namedStyles,
    editing,
    effectiveLayout,
    fitScale,
    facsimilePreset,
    facsimilePresetTokens,
    activeFontToken,
    verticalRail,
    railLayout,
    themePresetTokens,
    themeBaseTokens,
    tokens,
    panelLayout,
    panelTokens,
    fontSizeNum,
    lineHeightNum,
    customized,
    onApplyThemeTokens,
    onFontSizeUpdate,
    resetSettings,
  };
}

export type LayoutTokensApi = ReturnType<typeof useLayoutTokens>;
