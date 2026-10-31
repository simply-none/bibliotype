/**
 * useReader / useReaderBinding 组合式封装
 *
 * Reader 状态机（无 DOM）→ Vue 响应式的桥：
 * 订阅 document:load / page:change / toc:ready，暴露当前页 / 总页数 /
 * 进度 / 布局 / 目录 / 页节点与导航方法；scope 销毁时自动解绑。
 */
import {
  computed,
  getCurrentScope,
  isRef,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
  type ShallowRef,
} from 'vue';
import type { BookDocument, BookNode } from '@bibliotype/core';
import type { LayoutOptions, PaginatedPage } from '@bibliotype/layout';
import {
  Reader,
  type OutlineItem,
  type ReaderOptions,
  type RepaginateOptions,
} from '@bibliotype/reader';

/** 绑定 Reader 的响应式状态与操作 */
export interface ReaderBinding {
  /** 绑定的 Reader 实例（响应式：宿主替换实例后随源更新） */
  reader: ComputedRef<Reader>;
  /** 当前页（自 0 起） */
  currentPage: Ref<number>;
  /** 总页数 */
  totalPages: Ref<number>;
  /** 阅读进度（0~1） */
  progress: Ref<number>;
  /** 当前布局配置（重排后更新引用） */
  layout: ShallowRef<LayoutOptions>;
  /** 分页结果（重排 / 重载后更新引用；导航不改内容故同一引用不触发重建） */
  pagination: ShallowRef<readonly PaginatedPage[]>;
  /** 目录树 */
  outline: ShallowRef<readonly OutlineItem[]>;
  /** 当前页对应目录项（目录高亮用；无目录 / 封面页前为 undefined） */
  activeOutlineItem: ComputedRef<OutlineItem | undefined>;
  /** 当前页对应目录项定位键（与 `TocViewItem.key` 同口径） */
  activeOutlineKey: ComputedRef<string | undefined>;
  /** 当前页节点（块 id 已还原为 IR 节点） */
  pageNodes: ComputedRef<readonly BookNode[]>;
  /** 当前页展示页码（按页码样式格式化；无页时为空串） */
  pageNumberText: ComputedRef<string>;
  /** 下一页（返回是否发生翻页） */
  next: () => boolean;
  /** 上一页（返回是否发生翻页） */
  prev: () => boolean;
  /** 跳转页码（越界返回 false） */
  goToPage: (pageIndex: number) => boolean;
  /** 按节点 id 跳页（支持叶块 id 与结构容器 id） */
  goToNode: (nodeId: string) => boolean;
  /** 重新分页（字号 / 页面尺寸 / 估算上下文变更） */
  repaginate: (overrides?: RepaginateOptions) => void;
}

/** useReader 返回值：绑定 + 文档载入 */
export interface UseReaderReturn extends ReaderBinding {
  /** 载入 / 替换文档（重排并刷新状态） */
  loadDocument: (document: BookDocument) => void;
}

/**
 * 绑定既有 Reader 实例：事件 → 响应式状态
 *
 * 来源可以是实例、Ref 或 getter：宿主在运行期**替换 Reader 实例**（换书 /
 * 换主题 / 导入后重建等）时，事件自动改绑新实例、状态随之刷新——曾只在
 * setup 时捕获一次实例，宿主换实例后组件仍渲染旧文档（阅读区不跟随导入）。
 * 在组件 / effectScope 内调用时，scope 销毁自动解绑事件。
 */
export function useReaderBinding(source: Reader | MaybeRefOrGetter<Reader>): ReaderBinding {
  const getReader = (): Reader => toValue(source);
  const reader = computed(() => getReader());
  const currentPage = ref(getReader().currentPage);
  const totalPages = ref(getReader().totalPages);
  const progress = ref(getReader().progress);
  const layout = shallowRef<LayoutOptions>(getReader().layout);
  const pagination = shallowRef<readonly PaginatedPage[]>(getReader().pagination);
  const outline = shallowRef<readonly OutlineItem[]>(getReader().outline);

  const sync = (): void => {
    const reader = getReader();
    currentPage.value = reader.currentPage;
    totalPages.value = reader.totalPages;
    progress.value = reader.progress;
    layout.value = reader.layout;
    // 分页数组仅在重排 / 重载时换新引用，导航保持同一引用（shallowRef 不触发）
    pagination.value = reader.pagination;
  };
  const syncWithOutline = (): void => {
    outline.value = getReader().outline;
    sync();
  };

  const bind = (target: Reader): (() => void)[] => [
    target.events.on('page:change', sync),
    target.events.on('document:load', syncWithOutline),
    target.events.on('toc:ready', syncWithOutline),
  ];
  let unbind: (() => void)[] = bind(getReader());
  // 实例替换：改绑事件并把状态整体拉到新实例的当前值（旧订阅先解绑防串书）
  if (isRef(source) || typeof source === 'function') {
    watch(source, (next, prev) => {
      if (next === prev) return;
      for (const off of unbind) off();
      unbind = bind(getReader());
      syncWithOutline();
    });
  }
  if (getCurrentScope() !== undefined) {
    onScopeDispose(() => {
      for (const off of unbind) off();
    });
  }

  return {
    reader,
    currentPage,
    totalPages,
    progress,
    layout,
    pagination,
    outline,
    activeOutlineItem: computed(() => getReader().getOutlineItemAtPage(currentPage.value)),
    // 用定位表里的 key（无 id 节点回退树路径），与 toc-model / 折叠集合同源
    activeOutlineKey: computed(() => getReader().getOutlineAnchorAtPage(currentPage.value)?.key),
    pageNodes: computed(() => getReader().getPageNodes(currentPage.value)),
    pageNumberText: computed(() => {
      const page = currentPage.value;
      if (totalPages.value === 0 || page < 0) return '';
      return getReader().formatCurrentPageNumber();
    }),
    next: () => getReader().nextPage(),
    prev: () => getReader().prevPage(),
    goToPage: (pageIndex) => getReader().goToPage(pageIndex),
    goToNode: (nodeId) => getReader().goToNode(nodeId),
    repaginate: (overrides) => getReader().repaginate(overrides),
  };
}

/**
 * 创建或绑定 Reader 并转为响应式
 *
 * - source 为 BookDocument：新建 Reader 并自动载入；
 * - source 为 Reader：直接绑定（不重复载入）；
 * - source 省略：新建空 Reader，待后续 loadDocument；
 * - source 为 ref / getter 时监听变化，自动重载文档。
 */
export function useReader(
  source?: MaybeRefOrGetter<BookDocument | Reader | undefined>,
  options: ReaderOptions = {},
): UseReaderReturn {
  const initial = toValue(source);
  const reader = initial instanceof Reader ? initial : new Reader(options);
  if (initial !== undefined && !(initial instanceof Reader)) {
    reader.loadDocument(initial);
  }

  const binding = useReaderBinding(reader);

  if (source !== undefined && !(initial instanceof Reader)) {
    watch(
      () => toValue(source),
      (value) => {
        if (value !== undefined && !(value instanceof Reader)) {
          reader.loadDocument(value);
        }
      },
    );
  }

  return {
    ...binding,
    loadDocument: (document) => reader.loadDocument(document),
  };
}
