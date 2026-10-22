/**
 * 书籍元数据派生与保存
 *
 * 顶部书名 / 书籍信息弹窗都读它。元数据是文档的一部分，Reader / BookEditor 是
 * 普通类实例（非响应式），故经 bookVersion 显式失效：编辑态取编辑器实时快照，
 * 阅读态取 Reader 文档（缺省样章）。仅编辑模式可写（updateMetadata）。
 */
import { computed, type Ref, type ShallowRef } from 'vue';
import { type BookMetadata } from '@bibliotype/core';
import { type BookEditor } from '@bibliotype/editor';
import { Reader } from '@bibliotype/reader';
import { lunyuDocument } from '../data/lunyu.js';

/** 顶部书名的兜底值（元数据缺失标题时使用） */
export const DEFAULT_BOOK_TITLE = '论语集解';

export interface BookMetaDeps {
  mode: Ref<'read' | 'edit'>;
  bookEditor: ShallowRef<BookEditor | null>;
  reader: ShallowRef<Reader>;
  bookVersion: Ref<number>;
}

/** 书名 / 元数据派生与写回 */
export function useBookMeta(deps: BookMetaDeps) {
  const { mode, bookEditor, reader, bookVersion } = deps;

  /** 信息弹窗可编辑：仅编辑模式下（元数据写入 BookEditor.updateMetadata） */
  const infoEditable = computed(() => mode.value === 'edit' && bookEditor.value !== null);

  /** 当前元数据：编辑态取编辑器实时快照，阅读态取 Reader 文档（缺省样章） */
  const currentMetadata = computed<BookMetadata>(() => {
    /* 显式依赖：实例内部变更不走响应式，靠版本号自增让它失效（见 bookVersion） */
    void bookVersion.value;
    return (
      (mode.value === 'edit' && bookEditor.value !== null
        ? bookEditor.value.getMetadata()
        : reader.value.document?.metadata) ?? lunyuDocument.metadata
    );
  });

  /** 顶部书名：优先书籍元数据标题（编辑态随编辑器实时刷新），缺失 / 空白回退默认 */
  const bookTitle = computed<string>(() => {
    const title = currentMetadata.value.title?.trim() ?? '';
    return title === '' ? DEFAULT_BOOK_TITLE : title;
  });

  /** 元数据保存：写回编辑器（合并补丁 + 自动刷新 updatedAt）；阅读态不可达 */
  function onMetadataSave(patch: Partial<BookMetadata>): void {
    bookEditor.value?.updateMetadata(patch);
    // 元数据变更 → 顶部书名 / 书籍信息弹窗重新取值
    bookVersion.value += 1;
  }

  return { infoEditable, currentMetadata, bookTitle, onMetadataSave };
}
