/**
 * 目录视图组合式
 *
 * 把 `toc-model` 的纯函数接入 Vue：活动项、折叠集合、搜索词 → 可见行；
 * 折叠集合默认**受控**（`expandedKeys` + `onExpandedKeysChange`），由宿主决定
 * 存到哪（localStorage / IndexedDB / 远端）——库内不写存储，保持 SSR 与可测。
 *
 * 活动项滚入视野只依赖容器 DOM 查询，不要求逐行注册 ref（千条目录下省一次
 * 全量收集）；`scrollIntoView` 在 happy-dom / 旧环境中可能缺失，已做特性检测。
 */
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
} from 'vue';
import { collectOutlineKeys, type Reader } from '@bibliotype/reader';
import { buildTocViewItems, toggleTocExpanded, type TocViewItem } from './toc-model.js';
import { useReaderBinding } from './use-reader.js';

/** useTocView 入参 */
export interface UseTocViewOptions {
  /** 阅读器（提供目录树与当前页） */
  reader: Reader;
  /** 已展开键集合（受控；省略时组件内部维护） */
  expandedKeys?: MaybeRefOrGetter<readonly string[] | undefined>;
  /** 折叠集合变更回调（受控模式下由宿主持久化） */
  onExpandedKeysChange?: (keys: string[]) => void;
  /** 搜索词（受控） */
  query?: MaybeRefOrGetter<string | undefined>;
  /** 未受控且尚未操作时的默认展开状态（默认 true） */
  expandByDefault?: boolean;
}

/** useTocView 返回值 */
export interface UseTocView {
  /** 可见目录行（已按折叠 / 搜索过滤） */
  rows: ComputedRef<TocViewItem[]>;
  /** 当前活动目录项键 */
  activeKey: ComputedRef<string | undefined>;
  /** 目录是否为空（含搜索无命中） */
  isEmpty: ComputedRef<boolean>;
  /** 目录树全部键（全展开 / 全收起用） */
  allKeys: ComputedRef<string[]>;
  /** 切换某一项的展开状态 */
  toggle: (key: string) => void;
  /** 全部展开（会调用 `onExpandedKeysChange`） */
  expandAll: () => void;
  /** 全部收起 */
  collapseAll: () => void;
  /** 绑定滚动容器（用于活动项滚入视野） */
  attachContainer: (element: Element | null) => void;
  /** 手动把活动项滚入视野（滚动定位可视） */
  scrollActiveIntoView: () => void;
}

/** 目录行的 DOM 标记属性（与 `BtTocItem` 对齐） */
export const TOC_ROW_KEY_ATTRIBUTE = 'data-toc-key';

/**
 * 创建目录视图组合式
 *
 * @param options 见 {@link UseTocViewOptions}
 */
export function useTocView(options: UseTocViewOptions): UseTocView {
  const { reader, onExpandedKeysChange, expandByDefault = true } = options;
  const binding = useReaderBinding(reader);
  /** 未受控时的内部折叠集合；`undefined` 表示「尚未操作，走默认展开」 */
  const innerKeys = ref<readonly string[] | undefined>(undefined);
  const container = ref<Element | null>(null);

  // 活动键取自定位表（与折叠集合 / 行键同源），不直接用 nodeId（自造目录项可能无 id）
  const activeKey = computed<string | undefined>(
    () => reader.getOutlineAnchorAtPage(binding.currentPage.value)?.key,
  );
  const allKeys = computed<string[]>(() => collectOutlineKeys(binding.outline.value));
  const expandedKeys = computed<readonly string[] | undefined>(() => {
    const controlled =
      options.expandedKeys === undefined ? undefined : toValue(options.expandedKeys);
    return controlled ?? innerKeys.value;
  });
  const query = computed<string | undefined>(() =>
    options.query === undefined ? undefined : toValue(options.query),
  );

  const rows = computed<TocViewItem[]>(() =>
    buildTocViewItems(binding.outline.value, {
      ...(activeKey.value === undefined ? {} : { activeKey: activeKey.value }),
      ...(expandedKeys.value === undefined ? {} : { expandedKeys: expandedKeys.value }),
      expandByDefault,
      ...(query.value === undefined ? {} : { query: query.value }),
    }),
  );

  /** 当前生效的折叠集合：尚未操作时按「全部展开」参与运算 */
  const resolveKeys = (): readonly string[] =>
    expandedKeys.value ?? (expandByDefault ? allKeys.value : []);

  const commit = (keys: string[]): void => {
    if (onExpandedKeysChange !== undefined) {
      onExpandedKeysChange(keys);
      return;
    }
    innerKeys.value = keys;
  };

  const toggle = (key: string): void => {
    commit(toggleTocExpanded(resolveKeys(), key));
  };

  const expandAll = (): void => {
    commit([...allKeys.value]);
  };

  const collapseAll = (): void => {
    commit([]);
  };

  const attachContainer = (element: Element | null): void => {
    container.value = element;
  };

  const scrollActiveIntoView = (): void => {
    const host = container.value;
    const key = activeKey.value;
    if (host === null || key === undefined) return;
    const row = host.querySelector(`[${TOC_ROW_KEY_ATTRIBUTE}="${escapeSelectorValue(key)}"]`);
    if (row === null) return;
    // happy-dom / 旧内核无 scrollIntoView：特性检测后静默跳过（不影响高亮）
    if (typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  };

  // 活动项变化后等 DOM 更新完再定位（折叠展开会改变行位置）
  const stop = watch(activeKey, () => scrollActiveIntoView(), { flush: 'post' });
  if (getCurrentScope() !== undefined) onScopeDispose(stop);

  return {
    rows,
    activeKey,
    isEmpty: computed(() => rows.value.length === 0),
    allKeys,
    toggle,
    expandAll,
    collapseAll,
    attachContainer,
    scrollActiveIntoView,
  };
}

/** 属性选择器转义：目录键可能含 `/`（树路径）与引号等特殊字符 */
function escapeSelectorValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
