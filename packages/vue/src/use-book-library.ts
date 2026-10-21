/**
 * 书架状态（组合式函数）
 *
 * 数据口径：
 * - 查询走可选端口 `BookLibraryStore`；未实现时退化为 `list()` + 纯函数过滤；
 * - 阅读进度 / 最近阅读写 `BookSummaryStore`；未实现时「打开」只做前端状态；
 * - `.btbook` 打包需要宿主注入 `BookPackCodec`（vue 包不引入压缩库）。
 *
 * 组件只消费本函数返回的状态与方法，不直接碰存储。
 */
import {
  buildDocumentSummary,
  isAssetStore,
  isBookLibraryStore,
  isBookSummaryStore,
  packBookArchive,
  queryDocumentSummaries,
  unpackBookArchive,
} from '@bibliotype/core';
import type {
  BookDocument,
  BookPackAsset,
  BookPackCodec,
  BookQueryResult,
  DocumentQuery,
  DocumentSortKey,
  DocumentSummary,
  StorageAdapter,
} from '@bibliotype/core';
import { computed, ref, shallowRef, type ComputedRef, type Ref } from 'vue';
import { buildShelfCards, buildTagFacets, emptyShelfHint } from './book-shelf-model.js';
import type { ShelfCard, TagFacet } from './book-shelf-model.js';

/** 书架视图模式 */
export const SHELF_VIEW_MODES = {
  GRID: 'grid',
  LIST: 'list',
} as const;

/** 书架视图模式联合 */
export type ShelfViewMode = (typeof SHELF_VIEW_MODES)[keyof typeof SHELF_VIEW_MODES];

/** 组合式函数选项 */
export interface UseBookLibraryOptions {
  /** 存储适配器（可选能力按需探测） */
  store: StorageAdapter;
  /** `.btbook` 压缩端口（导出 / 导入需要） */
  codec?: BookPackCodec;
  /** 时间来源（缺省 `Date.now`；SSR / 测试注入固定值） */
  now?: () => number;
  /** 每页条数（缺省 60） */
  pageSize?: number;
  /** 收集某本书的资产（缺省不打包资产） */
  collectAssets?: (bookId: string, document: BookDocument) => Promise<BookPackAsset[]>;
  /** 读取注记（导入时透传给宿主） */
  loadAnnotations?: (bookId: string) => Promise<unknown>;
  /** 保存注记（导出时读、导入时写） */
  saveAnnotations?: (bookId: string, annotations: unknown) => Promise<void>;
}

/** 导出结果 */
export interface ShelfExportResult {
  /** 建议文件名（`论语.btbook`） */
  fileName: string;
  /** 包字节 */
  bytes: Uint8Array;
  /** 摘要（成功提示用） */
  title: string;
}

/** 导入结果 */
export interface ShelfImportResult {
  /** 写入的文档 id */
  id: string;
  /** 标题 */
  title: string;
}

/** 书架组合式函数返回值 */
export interface UseBookLibraryReturn {
  /** 卡片列表（当前页） */
  cards: ComputedRef<ShelfCard[]>;
  /** 原始摘要（当前页） */
  summaries: Ref<DocumentSummary[]>;
  /** 命中总数 */
  total: Ref<number>;
  /** 标签筛选胶囊 */
  facets: ComputedRef<TagFacet[]>;
  /** 检索词 */
  search: Ref<string>;
  /** 已选标签 */
  activeTags: Ref<string[]>;
  /** 排序键 */
  sortBy: Ref<DocumentSortKey>;
  /** 视图模式 */
  viewMode: Ref<ShelfViewMode>;
  /** 是否加载中 */
  loading: Ref<boolean>;
  /** 错误信息（中文） */
  error: Ref<string>;
  /** 空库提示（区分「检索无结果」） */
  emptyHint: ComputedRef<string>;
  /** 重新查询 */
  refresh: () => Promise<void>;
  /** 设置检索词并查询 */
  setSearch: (text: string) => Promise<void>;
  /** 切换标签筛选 */
  toggleTag: (tag: string) => Promise<void>;
  /** 切换排序 */
  setSort: (sortBy: DocumentSortKey) => Promise<void>;
  /** 切换视图 */
  setView: (mode: ShelfViewMode) => void;
  /** 打开书籍：记录最近阅读与进度（可选） */
  openBook: (id: string, progress?: number) => Promise<DocumentSummary | undefined>;
  /** 导出单本 `.btbook` */
  exportBook: (id: string) => Promise<ShelfExportResult>;
  /** 导入单本 `.btbook` */
  importBook: (bytes: Uint8Array) => Promise<ShelfImportResult>;
  /** 从书库移除 */
  removeBook: (id: string) => Promise<boolean>;
  /** 当前查询条件快照 */
  currentQuery: ComputedRef<DocumentQuery>;
}

/** 组合式函数：书架状态 */
export function useBookLibrary(options: UseBookLibraryOptions): UseBookLibraryReturn {
  const now = options.now ?? (() => Date.now());
  const pageSize = options.pageSize ?? 60;

  const summaries = ref<DocumentSummary[]>([]);
  const total = ref(0);
  const search = ref('');
  const activeTags = ref<string[]>([]);
  const sortBy = ref<DocumentSortKey>('recentRead');
  const viewMode = ref<ShelfViewMode>(SHELF_VIEW_MODES.GRID);
  const loading = ref(false);
  const error = ref('');
  const allTags = shallowRef<DocumentSummary[]>([]);

  const currentQuery = computed<DocumentQuery>(() => ({
    text: search.value,
    tags: activeTags.value,
    sortBy: sortBy.value,
    limit: pageSize,
  }));

  const cards = computed(() => buildShelfCards(summaries.value, { now: now() }));
  const facets = computed(() => buildTagFacets(allTags.value));
  const emptyHint = computed(() =>
    emptyShelfHint({ hasQuery: search.value.trim() !== '' || activeTags.value.length > 0 }),
  );

  /** 统一查询（有端口走端口，无端口走纯函数） */
  async function runQuery(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      let result: BookQueryResult;
      if (isBookLibraryStore(options.store)) {
        result = await options.store.query(currentQuery.value);
      } else {
        result = queryDocumentSummaries(await options.store.list(), currentQuery.value);
      }
      summaries.value = result.items;
      total.value = result.total;
      // 标签胶囊基于全量摘要（不受当前标签筛选影响）
      allTags.value = await options.store.list();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
    }
  }

  async function refresh(): Promise<void> {
    await runQuery();
  }

  async function setSearch(text: string): Promise<void> {
    search.value = text;
    await runQuery();
  }

  async function toggleTag(tag: string): Promise<void> {
    const current = activeTags.value;
    activeTags.value = current.includes(tag)
      ? current.filter((item) => item !== tag)
      : [...current, tag];
    await runQuery();
  }

  async function setSort(next: DocumentSortKey): Promise<void> {
    sortBy.value = next;
    await runQuery();
  }

  function setView(mode: ShelfViewMode): void {
    viewMode.value = mode;
  }

  async function openBook(
    id: string,
    progress?: number,
  ): Promise<DocumentSummary | undefined> {
    if (!isBookSummaryStore(options.store)) {
      return summaries.value.find((item) => item.id === id);
    }
    const patch: { lastOpenedAt: number; progress?: number } = { lastOpenedAt: now() };
    if (progress !== undefined) {
      patch.progress = progress;
    }
    const updated = await options.store.updateSummary(id, patch);
    if (updated !== undefined) {
      summaries.value = summaries.value.map((item) => (item.id === id ? updated : item));
    }
    return updated;
  }

  async function exportBook(id: string): Promise<ShelfExportResult> {
    if (options.codec === undefined) {
      throw new Error('导出 .btbook 需要宿主注入 BookPackCodec（如 fflate 适配）。');
    }
    const document = await options.store.load(id);
    if (document === undefined) {
      throw new Error(`书库中找不到文档 ${id}，请刷新书架后重试。`);
    }
    const summary =
      summaries.value.find((item) => item.id === id) ??
      buildDocumentSummary({ id, metadata: document.metadata, updatedAt: now() });
    const annotations =
      options.loadAnnotations === undefined ? undefined : await options.loadAnnotations(id);
    const assets =
      options.collectAssets === undefined ? undefined : await options.collectAssets(id, document);
    const bytes = await packBookArchive(
      {
        id,
        document,
        createdAt: now(),
        summary,
        ...(annotations === undefined ? {} : { annotations }),
        ...(assets === undefined ? {} : { assets }),
      },
      options.codec,
    );
    return { fileName: `${summary.title || id}.btbook`, bytes, title: summary.title };
  }

  async function importBook(bytes: Uint8Array): Promise<ShelfImportResult> {
    if (options.codec === undefined) {
      throw new Error('导入 .btbook 需要宿主注入 BookPackCodec（如 fflate 适配）。');
    }
    const unpacked = await unpackBookArchive(bytes, options.codec);
    const assetStore = isAssetStore(options.store) ? options.store : undefined;
    if (assetStore !== undefined) {
      for (const asset of unpacked.assets) {
        await assetStore.putAsset(asset.id, asset.payload);
      }
    }
    await options.store.save(unpacked.manifest.id, unpacked.document, {
      updatedAt: unpacked.summary.updatedAt,
    });
    if (isBookSummaryStore(options.store)) {
      await options.store.updateSummary(unpacked.manifest.id, {
        tags: unpacked.summary.tags,
        coverThumbnail: unpacked.summary.coverThumbnail,
        progress: unpacked.summary.progress,
        lastOpenedAt: unpacked.summary.lastOpenedAt,
      });
    }
    if (options.saveAnnotations !== undefined && unpacked.annotations !== undefined) {
      await options.saveAnnotations(unpacked.manifest.id, unpacked.annotations);
    }
    await runQuery();
    return { id: unpacked.manifest.id, title: unpacked.manifest.title };
  }

  async function removeBook(id: string): Promise<boolean> {
    const removed = await options.store.delete(id);
    if (removed) {
      await runQuery();
    }
    return removed;
  }

  return {
    cards,
    summaries,
    total,
    facets,
    search,
    activeTags,
    sortBy,
    viewMode,
    loading,
    error,
    emptyHint,
    refresh,
    setSearch,
    toggleTag,
    setSort,
    setView,
    openBook,
    exportBook,
    importBook,
    removeBook,
    currentQuery,
  };
}
