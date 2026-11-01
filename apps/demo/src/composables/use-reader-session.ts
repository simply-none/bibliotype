/**
 * Reader 会话：实例重建、DOM 实测重排与页态订阅
 *
 * 预览 Reader 与编辑画布 / PDF 导出共用同一份估算口径（typographyMeasure /
 * pageMainSize / bottomSlack / 实测块尺寸），保证三端逐页归属一致。
 * 主题切换重建 Reader（布局补丁随主题重置，字号等个人设置保留）；度量签名
 * （只含影响分页的参数）变化才重测量尺并重排，纯视觉改动不重排。
 *
 * 块尺寸 / 行边界由量尺工作表逐块实测产出（`measurePagination`），喂给 Reader；
 * 直排 / 多栏回退估算（空映射）。跨块写操作（切主题的 layoutPatch / themePresetTokens）
 * 经参数注入的 ref 直接赋值。
 */
import {
  computed,
  nextTick,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue';
import { type BookDocument } from '@bibliotype/core';
import {
  computeMetricsSignature,
  isVerticalMode,
  resolvePageCrossSize,
  resolvePaginationGeometry,
  resolveVerticalMeasureContext,
  type BlockAxis,
  type LayoutOptions,
} from '@bibliotype/layout';
import { DEFAULT_MEASURE_CONTEXT, Reader, type BlockMeasureContext } from '@bibliotype/reader';
import { measurePagination, useDocumentStats } from '@bibliotype/vue';
import { lunyuDocument } from '../data/lunyu.js';
import type { StyleSettingsApi } from './use-style-settings.js';
import type { ThemeKey } from './use-app-themes.js';

export interface ReaderSessionDeps {
  effectiveLayout: ComputedRef<LayoutOptions>;
  tokens: ComputedRef<Readonly<Record<string, string | undefined>>>;
  activeFontToken: ComputedRef<string>;
  fontSizeNum: ComputedRef<number>;
  lineHeightNum: ComputedRef<number>;
  features: StyleSettingsApi['features'];
  /** 切主题时重置：布局补丁与主题预设差量随主题失效 */
  layoutPatch: Ref<Partial<LayoutOptions>>;
  themePresetTokens: Ref<Record<string, string>>;
  /** 主题源状态（switchTheme 需判重并写回） */
  themeKey: Ref<ThemeKey>;
  /** 页码落盘（snapshot 块） */
  writeLastPage: (pageIndex: number) => void;
  /** 阅读位置锚点落盘（snapshot 块） */
  writeSavedPosition: (json: string) => void;
  /** 启动恢复完成标志：就绪后才重新订阅重建后的 Reader */
  booted: Ref<boolean>;
}

/** Reader 实例、实测块尺寸与重排调度 */
export function useReaderSession(deps: ReaderSessionDeps) {
  const {
    effectiveLayout,
    tokens,
    activeFontToken,
    fontSizeNum,
    lineHeightNum,
    layoutPatch,
    themePresetTokens,
    themeKey,
    writeLastPage,
    writeSavedPosition,
    booted,
  } = deps;

  /**
   * 估算上下文（与字号 / 行距 / 开本联动）
   *
   * 横排：每行字数按页面交叉轴（内容宽）与字号折算，0.95 为 CJK 字宽近似
   * 因子，行尺寸 = 字号 × 行距。
   *
   * 直排：走**字位网格**口径（resolveVerticalMeasureContext）——一「行」就是
   * 一个字位，`lineSize` 是字位宽（列距 ÷ 每列字数）、`blockSpacing` 为 0、
   * `columnPitch` 为列距。曾把横排口径（每行 ~52 字 × 行高 30）喂直排：一列
   * 被当成一行，页容量被压成 (列数 × 单字高)，页内只装十几块 ≈ 二百余字，
   * 用户可见「每页大片空白 + 段落中途截断」。
   *
   * 交叉轴走 `resolvePageCrossSize`：解析 page-margin 令牌、扣掉版框边框，
   * 直排下还扣页眉 / 页脚占位（吃的是每列行长，不是列数）。
   */
  function typographyMeasure(): Partial<BlockMeasureContext> {
    const layout = effectiveLayout.value;
    if (isVerticalMode(layout.writingMode)) {
      const slot = resolveVerticalMeasureContext(layout, tokens.value);
      return {
        charsPerLine: slot.charsPerLine,
        lineSize: slot.lineSize,
        blockSpacing: slot.blockSpacing,
        columnPitch: slot.columnPitch,
      };
    }
    const cross = resolvePageCrossSize(layout, tokens.value);
    return {
      charsPerLine: Math.max(1, Math.round((cross / fontSizeNum.value) * 0.95)),
      lineSize: Math.round(fontSizeNum.value * lineHeightNum.value),
    };
  }

  /** 完整估算上下文（传给 BtEditor，与 Reader 内部 { ...DEFAULT, ...measure } 同值） */
  const measureContext = computed<BlockMeasureContext>(() => ({
    ...DEFAULT_MEASURE_CONTEXT,
    ...typographyMeasure(),
  }));

  /**
   * 分页几何（预览与编辑共用同一口径，保证分页归属一致）：
   * 主轴按行网格取整（容量恒为整行数，页底留白全书恒定，不再随机差半行）、
   * 溢出余量承接注音等高于步进的行盒、末行最深到页码字形上方 3px。
   */
  const paginationGeometry = computed(() =>
    resolvePaginationGeometry(effectiveLayout.value, tokens.value),
  );
  const pageMainSize = computed(() => paginationGeometry.value.pageMainSize);

  /** 页底溢出（px）= 原始容量 − 行网格容量（见 resolvePaginationGeometry） */
  const bottomSlack = computed(() => paginationGeometry.value.bottomSlack);

  /**
   * DOM 实测块尺寸（块 id → 主轴尺寸 px）与每行起始字符偏移（块 id → number[]）
   *
   * 由量尺工作表对当前文档逐块实测产出，喂给 Reader（预览逐页）：尺寸定分页归属，
   * 行偏移定跨页块的真实行切片；直排 / 多栏回退估算（空映射）。bodySizes 供 paginate
   * 按体高计「往本页追加一块」的代价，消除每页虚耗一份块间距造成的页底空白。
   */
  const blockSizes = shallowRef<ReadonlyMap<string, number>>(new Map());
  const blockLineOffsets = shallowRef<ReadonlyMap<string, number[]>>(new Map());
  const blockLineSizes = shallowRef<ReadonlyMap<string, number>>(new Map());
  /** 逐行行盒尺寸（注音行不等高时按行判页；与 lineSizes 同源实测） */
  const blockLineMainSizes = shallowRef<ReadonlyMap<string, number[]>>(new Map());
  const blockBodySizes = shallowRef<ReadonlyMap<string, number>>(new Map());
  /** 块 id → 行数（直排为字位数；横排为空表，行边界由 lineOffsets 承载） */
  const blockLineCounts = shallowRef<ReadonlyMap<string, number>>(new Map());
  /** 量尺解析出的排文主轴（直排 column），透传给 Reader 的块 axis 标注 */
  const blockAxis = shallowRef<BlockAxis>('row');

  /**
   * Reader 实例代际（每次重建自增）
   *
   * 目录 / 搜索 / 书签 / 翻页 / 进度面板在 setup 里一次性订阅 Reader 事件，换实例
   * 不会自动重绑。`:key` 只跟主题会漏掉「重建但主题没变」的场景（首次按草稿恢复、
   * 还原样册），面板仍绑被弃用的初始 Reader（显示样章数据）；key 须同时随主题与代际变化。
   */
  const readerEpoch = ref(0);

  /** 创建已载入文档的 Reader（loadDocument 触发全链路分页，按当前排版估算） */
  function createReader(layout: LayoutOptions, document: BookDocument = lunyuDocument): Reader {
    const r = new Reader({
      layout,
      /* 令牌透传：Reader 在直排下自行按「布局 + 令牌」推导字位口径（换主题 /
       * 漏传 measure 的宿主不会被横排量尺带偏），推导结果必须与主题同源 */
      tokens: tokens.value,
      measure: typographyMeasure(),
      pageMainSize: pageMainSize.value,
      bottomSlack: bottomSlack.value,
      blockSizes: blockSizes.value,
      lineOffsets: blockLineOffsets.value,
      lineSizes: blockLineSizes.value,
      lineMainSizes: blockLineMainSizes.value,
      lineCounts: blockLineCounts.value,
      bodySizes: blockBodySizes.value,
      axis: blockAxis.value,
    });
    r.loadDocument(document);
    readerEpoch.value += 1;
    return r;
  }

  const reader = shallowRef<Reader>(createReader(effectiveLayout.value));

  /**
   * 书籍版本号（文档 / 元数据变更计数）
   *
   * `Reader` 与 `BookEditor` 都是普通类实例（非响应式），同实例内的 loadDocument /
   * updateMetadata 不会让 computed 失效。凡这类落点手动自增，供 currentMetadata /
   * bookTitle 重新取值（顶部书名、书籍信息弹窗都依赖它）。
   */
  const bookVersion = ref(0);

  /** 当前文档引用（供统计组合式按引用变化重算） */
  const currentDocument = computed<BookDocument>(() => reader.value.document ?? lunyuDocument);

  /** 文档统计（状态栏）：300ms 防抖，随文档 / bookVersion 重算 */
  const documentStats = useDocumentStats({ document: currentDocument, revision: bookVersion });

  /** 重测当前 Reader 文档的块尺寸 / 行边界 / 真实行高并重排预览（DOM 实测，需已挂载） */
  function remeasure(): void {
    const doc = reader.value.document ?? lunyuDocument;
    const { sizes, lineOffsets, lineSizes, lineMainSizes, lineCounts, bodySizes, axis } =
      measurePagination({
        doc,
        options: effectiveLayout.value,
        tokens: tokens.value,
        fontToken: activeFontToken.value,
        /* 功能样式与渲染同源：度量签名含 features（会触发本函数），量尺也必须
         * 应用同一份 features——07ad411 只接了编辑态，阅读态漏传导致改行高 /
         * 段距类功能样式时分页归属与渲染错尺 */
        features: deps.features.value,
        measure: typographyMeasure(),
      });
    blockSizes.value = sizes;
    blockLineOffsets.value = lineOffsets;
    blockLineSizes.value = lineSizes;
    blockLineMainSizes.value = lineMainSizes;
    blockLineCounts.value = lineCounts;
    blockBodySizes.value = bodySizes;
    blockAxis.value = axis;
    reader.value.repaginate({
      layout: effectiveLayout.value,
      blockSizes: sizes,
      lineOffsets,
      lineSizes,
      lineMainSizes,
      lineCounts,
      bodySizes,
      axis,
      measure: typographyMeasure(),
      pageMainSize: pageMainSize.value,
      bottomSlack: bottomSlack.value,
    });
  }

  /** 去抖重测（等 DOM / 布局稳定，避免拖动字号 / 开本时频繁量尺） */
  let measureTimer: number | undefined;
  function scheduleRemeasure(): void {
    if (measureTimer !== undefined) clearTimeout(measureTimer);
    measureTimer = window.setTimeout(() => {
      measureTimer = undefined;
      void nextTick(remeasure);
    }, 120);
  }

  /** 清理去抖定时器（组件卸载时调用） */
  function clearRemeasureTimer(): void {
    if (measureTimer !== undefined) clearTimeout(measureTimer);
    measureTimer = undefined;
  }

  /** 页态订阅退订句柄（绑定当前 Reader 实例，实例重建时重挂） */
  let unsubscribePage: (() => void) | null = null;

  /** 订阅 Reader page:change → 页码持久化（翻页 / 滚动回写 / 目录书签跳转全覆盖） */
  function attachPageTracking(): void {
    unsubscribePage?.();
    unsubscribePage = reader.value.events.on('page:change', (payload) => {
      writeLastPage(payload.pageIndex);
    });
  }

  /** 退订页态（组件卸载时调用） */
  function detachPageTracking(): void {
    unsubscribePage?.();
    unsubscribePage = null;
  }

  /**
   * 阅读预览的排版度量签名
   *
   * 只有「会影响分页结果」的配置变化才重测量尺并重排（字号 / 行距 / 页边距 /
   * 分栏 / 版框 / 功能样式里的度量类声明）；改颜色、线型等纯视觉参数不重排。
   */
  const readerMetricsSignature = computed(() =>
    computeMetricsSignature({
      tokens: tokens.value,
      options: effectiveLayout.value,
      features: deps.features.value,
    }),
  );

  /** 度量签名变化：重测块尺寸并原地重排（视觉由 tokens / 样式表联动） */
  watch(readerMetricsSignature, scheduleRemeasure);

  // 主题切换 / 保存设置等重建 Reader：启动完成后才重新订阅新实例
  watch(reader, () => {
    if (booted.value) attachPageTracking();
  });

  /** 阅读位置变化（D5）：以锚点 JSON 持久化，刷新 / 改字号后回到原句 */
  function onReadingPosition(position: unknown): void {
    if (position === undefined || position === null) return;
    try {
      writeSavedPosition(JSON.stringify(position));
    } catch {
      /* 序列化 / 存储失败时静默，不阻断阅读 */
    }
  }

  /**
   * 切换主题：换 themeKey、清空布局补丁与主题预设差量，以当前阅读文档重建 Reader
   * （保留已保存的编辑内容与字号设置），再按新排版重测。
   */
  function switchTheme(key: ThemeKey): void {
    if (key === themeKey.value) return;
    themeKey.value = key;
    /* 以当前阅读文档重建 Reader（保留已保存的编辑内容与字号设置），布局补丁随主题重置 */
    const current = reader.value.document ?? lunyuDocument;
    layoutPatch.value = {};
    // 主题预设属于旧主题的配色差量，换主题即失效（否则会串味）
    themePresetTokens.value = {};
    reader.value = createReader(effectiveLayout.value, current);
    // 重建后按新排版重测（直排主题会回退估算，空映射安全）
    scheduleRemeasure();
  }

  return {
    reader,
    readerEpoch,
    bookVersion,
    currentDocument,
    documentStats,
    measureContext,
    pageMainSize,
    bottomSlack,
    typographyMeasure,
    blockSizes,
    blockLineOffsets,
    blockLineSizes,
    blockLineMainSizes,
    blockLineCounts,
    blockBodySizes,
    blockAxis,
    remeasure,
    scheduleRemeasure,
    clearRemeasureTimer,
    createReader,
    attachPageTracking,
    detachPageTracking,
    onReadingPosition,
    switchTheme,
  };
}

export type ReaderSessionApi = ReturnType<typeof useReaderSession>;
