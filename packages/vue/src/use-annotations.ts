/**
 * 标注组合式（消费 `@bibliotype/annotation`）
 *
 * 职责边界（见开发规范）：本组合式只做「选区 → 标注」「存储编排」「视图模型聚合」，
 * 不触碰正文、不实现持久化细节（由传入的 `AnnotationStore` 决定 indexedDB / http）。
 * 正文高亮 / 评论内联渲染不在本批范围（D9）。
 */
import { computed, ref, type Ref } from 'vue';
import type { Anchor, BookDocument } from '@bibliotype/core';
import {
  ANNOTATION_KINDS,
  ANNOTATION_SCHEMA_VERSION,
  type Annotation,
  type AnnotationAuthor,
  type AnnotationKind,
  type AnnotationStorage,
  createBookmark,
  createComment,
  createHighlight,
  createNote,
} from '@bibliotype/annotation';
import { buildAnnotationSidebarModel, type SidebarChapter } from './annotation-model.js';

/** 时钟（用于 createdAt；可注入以便测试确定性） */
export type Clock = () => string;

/** useAnnotations 入参 */
export interface UseAnnotationsOptions {
  /** 图书标识（标注存储键） */
  bookId: string;
  /** 当前文档（响应式），用于锚点解析与章节分组 */
  document: Ref<BookDocument>;
  /** 标注存储实现（indexedDB / http / 内存） */
  store: AnnotationStorage;
  /** 从当前编辑器选区取锚点（无选区返回 null） */
  getSelectionAnchor: () => Anchor | null;
  /** 点击标注时跳转到对应位置 */
  locate: (anchor: Anchor) => void;
  /** 创建者（缺省匿名） */
  author?: AnnotationAuthor;
  /** 时间源（缺省 ISO 当前时间） */
  clock?: Clock;
}

/** 标注组合式返回值 */
export interface UseAnnotations {
  /** 当前标注集合（响应式） */
  annotations: Ref<readonly Annotation[]>;
  /** 按章节分组的侧栏模型 */
  model: Ref<readonly SidebarChapter[]>;
  /** 从存储加载标注 */
  load: () => Promise<void>;
  /** 选区建标注（返回是否成功） */
  create: (kind: AnnotationKind, body?: string) => Promise<boolean>;
  /** 删除标注 */
  remove: (id: string) => Promise<void>;
  /** 标记 / 取消评论已解决 */
  resolveComment: (id: string, resolved: boolean) => Promise<void>;
  /** 评论回复 */
  reply: (id: string, body: string) => Promise<void>;
  /** 定位到标注 */
  locate: (anchor: Anchor) => void;
}

/**
 * 创建标注组合式
 *
 * @param options 见 {@link UseAnnotationsOptions}
 */
export function useAnnotations(options: UseAnnotationsOptions): UseAnnotations {
  const { bookId, document, store, getSelectionAnchor, locate, author, clock } = options;
  const now: Clock = clock ?? (() => new Date().toISOString());

  const annotations = ref<Annotation[]>([]);
  const model = computed(() =>
    buildAnnotationSidebarModel(document.value.root, annotations.value),
  );

  async function persist(): Promise<void> {
    await store.saveAnnotations(bookId, {
      schemaVersion: ANNOTATION_SCHEMA_VERSION,
      annotations: annotations.value,
    });
  }

  function build(kind: AnnotationKind, body?: string): Annotation | null {
    const anchor = getSelectionAnchor();
    if (anchor === null) return null;
    const common = { clock: now, author };
    switch (kind) {
      case ANNOTATION_KINDS.BOOKMARK:
        return createBookmark(anchor, { body, ...common });
      case ANNOTATION_KINDS.NOTE:
        return createNote(anchor, body ?? '', common);
      case ANNOTATION_KINDS.COMMENT:
        return createComment(anchor, body ?? '', author ?? { id: 'anon' }, { clock: now });
      case ANNOTATION_KINDS.HIGHLIGHT:
        return createHighlight(anchor, common);
      default:
        return null;
    }
  }

  async function create(kind: AnnotationKind, body?: string): Promise<boolean> {
    const annotation = build(kind, body);
    if (annotation === null) return false;
    annotations.value = [...annotations.value, annotation];
    await persist();
    return true;
  }

  async function remove(id: string): Promise<void> {
    annotations.value = annotations.value.filter((a) => a.id !== id);
    await persist();
  }

  async function resolveComment(id: string, resolved: boolean): Promise<void> {
    annotations.value = annotations.value.map((a) =>
      a.id === id && a.kind === ANNOTATION_KINDS.COMMENT ? { ...a, resolved } : a,
    );
    await persist();
  }

  async function reply(id: string, body: string): Promise<void> {
    const target = annotations.value.find((a) => a.id === id);
    if (target === undefined || target.kind !== ANNOTATION_KINDS.COMMENT) return;
    const comments = [
      ...(target.comments ?? []),
      { id: `${id}-r${target.comments?.length ?? 0}`, author: author ?? { id: 'anon' }, body, createdAt: now() },
    ];
    annotations.value = annotations.value.map((a) => (a.id === id ? { ...a, comments } : a));
    await persist();
  }

  async function load(): Promise<void> {
    const set = await store.loadAnnotations(bookId);
    annotations.value = set?.annotations ?? [];
  }

  return { annotations, model, load, create, remove, resolveComment, reply, locate };
}
