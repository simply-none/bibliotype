/**
 * 标注内存存储
 *
 * 定位：库层唯一的标注容器，UI（Vue / React）与存储适配器都通过它读写。
 * - 不修改入参，对外返回浅拷贝快照；
 * - `update` 不隐式取当前时间（时间由调用方注入），保证可测与可回溯；
 * - `subscribe` 供响应式层订阅变更，`hydrate` / `persist` 对接持久化端口。
 */
import {
  ANNOTATION_SCHEMA_VERSION,
  deserializeAnnotationSet,
  isAnnotation,
  serializeAnnotationSet,
} from './serialize.js';
import type {
  Annotation,
  AnnotationFilter,
  AnnotationKind,
  AnnotationSet,
  AnnotationStorage,
} from './types.js';

/** 可更新字段（id / kind / anchor / createdAt 不属于可更新面） */
export type AnnotationPatch = Partial<
  Pick<Annotation, 'color' | 'body' | 'comments' | 'resolved' | 'attrs' | 'author' | 'updatedAt'>
>;

/** 变更监听器 */
export type AnnotationListener = (annotations: readonly Annotation[]) => void;

/** 判断是否符合过滤条件 */
function matches(annotation: Annotation, filter?: AnnotationFilter): boolean {
  if (!filter) {
    return true;
  }
  if (filter.kind !== undefined) {
    const kinds: readonly AnnotationKind[] = Array.isArray(filter.kind)
      ? filter.kind
      : [filter.kind as AnnotationKind];
    if (!kinds.includes(annotation.kind)) {
      return false;
    }
  }
  if (filter.nodeId !== undefined && annotation.anchor.nodeId !== filter.nodeId) {
    return false;
  }
  if (filter.includeResolved === false && annotation.resolved === true) {
    return false;
  }
  return true;
}

/** 标注容器 */
export class AnnotationStore {
  private items: Annotation[];
  private readonly listeners = new Set<AnnotationListener>();

  constructor(initial: readonly Annotation[] = []) {
    initial.forEach((annotation) => {
      if (!isAnnotation(annotation as unknown)) {
        throw new TypeError(`初始化失败：标注 ${describeId(annotation)} 结构不合法。`);
      }
    });
    this.items = [...initial];
  }

  /** 标注数量 */
  get size(): number {
    return this.items.length;
  }

  /** 列出标注（返回拷贝，按创建时间 + id 稳定排序） */
  list(filter?: AnnotationFilter): Annotation[] {
    const picked = this.items.filter((annotation) => matches(annotation, filter));
    return picked
      .sort((left, right) => {
        if (left.createdAt === right.createdAt) {
          return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
        }
        return left.createdAt < right.createdAt ? -1 : 1;
      })
      .map(copyAnnotation);
  }

  /** 按 id 读取（返回拷贝） */
  get(id: string): Annotation | undefined {
    const hit = this.items.find((annotation) => annotation.id === id);
    return hit ? copyAnnotation(hit) : undefined;
  }

  /** 是否存在 */
  has(id: string): boolean {
    return this.items.some((annotation) => annotation.id === id);
  }

  /** 新增（id 重复时抛错，避免静默覆盖） */
  add(annotation: Annotation): Annotation {
    if (!isAnnotation(annotation)) {
      throw new TypeError('新增失败：标注结构不合法（需 id / kind / anchor / 时间字段）。');
    }
    if (this.has(annotation.id)) {
      throw new RangeError(`新增失败：标注 id "${annotation.id}" 已存在。`);
    }
    this.items = [...this.items, copyAnnotation(annotation)];
    this.notify();
    return copyAnnotation(annotation);
  }

  /** 批量新增（任一失败则整体不写入） */
  addMany(annotations: readonly Annotation[]): Annotation[] {
    const ids = new Set(this.items.map((annotation) => annotation.id));
    annotations.forEach((annotation) => {
      if (!isAnnotation(annotation)) {
        throw new TypeError('批量新增失败：存在结构不合法的标注。');
      }
      if (ids.has(annotation.id)) {
        throw new RangeError(`批量新增失败：标注 id "${annotation.id}" 已存在。`);
      }
      ids.add(annotation.id);
    });
    this.items = [...this.items, ...annotations.map(copyAnnotation)];
    this.notify();
    return annotations.map(copyAnnotation);
  }

  /** 局部更新（未命中返回 undefined） */
  update(id: string, patch: AnnotationPatch): Annotation | undefined {
    const index = this.items.findIndex((annotation) => annotation.id === id);
    if (index < 0) {
      return undefined;
    }
    const current = this.items[index];
    if (!current) {
      return undefined;
    }
    const next: Annotation = { ...current, ...patch };
    if (patch.attrs !== undefined) {
      next.attrs = { ...patch.attrs };
    }
    if (patch.comments !== undefined) {
      next.comments = patch.comments.map((entry) => ({ ...entry }));
    }
    this.items = [...this.items.slice(0, index), next, ...this.items.slice(index + 1)];
    this.notify();
    return copyAnnotation(next);
  }

  /** 删除 */
  remove(id: string): boolean {
    const next = this.items.filter((annotation) => annotation.id !== id);
    if (next.length === this.items.length) {
      return false;
    }
    this.items = next;
    this.notify();
    return true;
  }

  /** 清空 */
  clear(): void {
    if (this.items.length === 0) {
      return;
    }
    this.items = [];
    this.notify();
  }

  /** 整体替换（导入 / 协同合并后使用） */
  replaceAll(annotations: readonly Annotation[]): void {
    annotations.forEach((annotation) => {
      if (!isAnnotation(annotation)) {
        throw new TypeError('替换失败：存在结构不合法的标注。');
      }
    });
    this.items = annotations.map(copyAnnotation);
    this.notify();
  }

  /** 导出为可序列化集合 */
  toSet(): AnnotationSet {
    return {
      schemaVersion: ANNOTATION_SCHEMA_VERSION,
      annotations: this.list(),
    };
  }

  /** 序列化为 JSON（确定性） */
  toJSON(): string {
    return serializeAnnotationSet(this.items);
  }

  /** 从 JSON 恢复 */
  static fromJSON(json: string): AnnotationStore {
    return new AnnotationStore(deserializeAnnotationSet(json).annotations);
  }

  /** 从持久化端口载入（未命中保持现状） */
  async hydrate(storage: AnnotationStorage, bookId: string): Promise<number> {
    const set = await storage.loadAnnotations(bookId);
    if (!set) {
      return 0;
    }
    this.replaceAll(set.annotations);
    return set.annotations.length;
  }

  /** 写入持久化端口 */
  async persist(storage: AnnotationStorage, bookId: string): Promise<void> {
    await storage.saveAnnotations(bookId, this.toSet());
  }

  /** 订阅变更（返回取消函数） */
  subscribe(listener: AnnotationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.list();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

/** 取对象 id 描述（用于错误信息，容忍任意输入） */
function describeId(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    return id === undefined ? '未知' : String(id);
  }
  return '未知';
}

/** 拷贝标注（防止外部修改内部状态） */
function copyAnnotation(annotation: Annotation): Annotation {
  const copy: Annotation = { ...annotation };
  if (annotation.attrs !== undefined) {
    copy.attrs = { ...annotation.attrs };
  }
  if (annotation.comments !== undefined) {
    copy.comments = annotation.comments.map((entry) => ({ ...entry }));
  }
  if (annotation.author !== undefined) {
    copy.author = { ...annotation.author };
  }
  return copy;
}
