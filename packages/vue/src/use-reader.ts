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
import type { LayoutOptions } from '@bibliotype/layout';
import {
  Reader,
  type OutlineItem,
  type ReaderOptions,
  type RepaginateOptions,
} from '@bibliotype/reader';

/** 绑定 Reader 的响应式状态与操作 */
export interface ReaderBinding {
  /** 绑定的 Reader 实例（命令式 API 的原点） */
  reader: Reader;
  /** 当前页（自 0 起） */
  currentPage: Ref<number>;
  /** 总页数 */
  totalPages: Ref<number>;
  /** 阅读进度（0~1） */
  progress: Ref<number>;
  /** 当前布局配置（重排后更新引用） */
  layout: ShallowRef<LayoutOptions>;
  /** 目录树 */
  outline: ShallowRef<readonly OutlineItem[]>;
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
 * 在组件 / effectScope 内调用时，scope 销毁自动解绑事件。
 */
export function useReaderBinding(reader: Reader): ReaderBinding {
  const currentPage = ref(reader.currentPage);
  const totalPages = ref(reader.totalPages);
  const progress = ref(reader.progress);
  const layout = shallowRef<LayoutOptions>(reader.layout);
  const outline = shallowRef<readonly OutlineItem[]>(reader.outline);

  const sync = (): void => {
    currentPage.value = reader.currentPage;
    totalPages.value = reader.totalPages;
    progress.value = reader.progress;
    layout.value = reader.layout;
  };
  const syncWithOutline = (): void => {
    outline.value = reader.outline;
    sync();
  };

  const unsubscribe = [
    reader.events.on('page:change', sync),
    reader.events.on('document:load', syncWithOutline),
    reader.events.on('toc:ready', syncWithOutline),
  ];
  if (getCurrentScope() !== undefined) {
    onScopeDispose(() => {
      for (const off of unsubscribe) off();
    });
  }

  return {
    reader,
    currentPage,
    totalPages,
    progress,
    layout,
    outline,
    pageNodes: computed(() => reader.getPageNodes(currentPage.value)),
    pageNumberText: computed(() => {
      const page = currentPage.value;
      if (totalPages.value === 0 || page < 0) return '';
      return reader.formatCurrentPageNumber();
    }),
    next: () => reader.nextPage(),
    prev: () => reader.prevPage(),
    goToPage: (pageIndex) => reader.goToPage(pageIndex),
    goToNode: (nodeId) => reader.goToNode(nodeId),
    repaginate: (overrides) => reader.repaginate(overrides),
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
