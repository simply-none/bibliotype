/**
 * 书籍编辑器（无视图编辑状态机）
 *
 * 职责：聚合「schema 注册表 + IR 双向转换 + ProseMirror EditorState」，
 * 提供文档载入 / 导出、事务派发与变更订阅；
 * DOM 视图（prosemirror-view）与框架绑定由 vue / react 封装层负责。
 */
import { createEmptyDocument, type BookDocument, type BookMetadata } from '@bibliotype/core';
import type { Schema } from 'prosemirror-model';
import { EditorState, type Plugin, type Transaction } from 'prosemirror-state';
import { createDefaultEditorSchemaRegistry } from './default-schema.js';
import { irNodeToPm } from './ir-to-pm.js';
import { pmNodeToIr } from './pm-to-ir.js';
import type { EditorSchemaRegistry } from './schema-registry.js';

/** 编辑器构造选项 */
export interface BookEditorOptions {
  /** 自定义 schema（优先级高于 registry） */
  schema?: Schema;
  /** 自定义规格注册表（不传则使用标准注册表） */
  registry?: EditorSchemaRegistry;
  /** 初始文档（缺省为空文档） */
  document?: BookDocument;
  /** 编辑插件（history / keymap 等，由 createBookEditorPlugins 生成） */
  plugins?: readonly Plugin[];
}

/** 文档变更处理器 */
export type BookEditorChangeHandler = (document: BookDocument) => void;

/** 书籍编辑器 */
export class BookEditor {
  private readonly schema: Schema;
  private readonly plugins: readonly Plugin[];
  private state: EditorState;
  private metadata: BookMetadata;
  private schemaVersion: string;
  private readonly changeHandlers = new Set<BookEditorChangeHandler>();

  constructor(options: BookEditorOptions = {}) {
    this.schema =
      options.schema ?? (options.registry ?? createDefaultEditorSchemaRegistry()).buildSchema();

    const initial = options.document ?? createEmptyDocument({ title: '' });
    this.metadata = initial.metadata;
    this.schemaVersion = initial.schemaVersion;
    this.plugins = options.plugins ?? [];
    this.state = EditorState.create({
      doc: irNodeToPm(initial.root, this.schema),
      plugins: [...this.plugins],
    });
  }

  /** 当前 ProseMirror 编辑状态（视图层消费） */
  get editorState(): EditorState {
    return this.state;
  }

  /** 编辑器 schema */
  get bookSchema(): Schema {
    return this.schema;
  }

  /** 当前文档元数据（只读快照，修改请用 updateMetadata） */
  getMetadata(): BookMetadata {
    return this.metadata;
  }

  /**
   * 合并更新元数据（保留未提及字段）
   *
   * - patch 中显式给出（含 undefined）的顶层键会被写入 / 移除；
   *   利用此语义可清空 subtitle 等可选字段；
   * - title 为必填：patch.title 为 undefined / 空串时忽略（不改原值）；
   * - createdAt 保持不变，实际发生变更时自动刷新 updatedAt 为当前时间戳；
   * - 与文档派发一致：更新后广播变更（订阅者可拿到含新元数据的快照）。
   */
  updateMetadata(patch: Partial<BookMetadata>): void {
    const next: Record<string, unknown> = { ...this.metadata };
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'title') {
        if (typeof value === 'string' && value !== '') {
          next.title = value;
        }
        continue; // title 必填，不因 patch 而删除
      }
      if (key === 'createdAt') {
        continue; // 创建时间不经由补丁修改
      }
      if (value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    const changed = JSON.stringify(next) !== JSON.stringify(this.metadata);
    if (!changed) {
      return;
    }
    next.updatedAt = new Date().toISOString();
    this.metadata = next as unknown as BookMetadata;
    this.emitChange();
  }

  /** 载入文档（重建编辑状态并广播变更） */
  loadDocument(document: BookDocument): void {
    this.metadata = document.metadata;
    this.schemaVersion = document.schemaVersion;
    this.state = EditorState.create({
      doc: irNodeToPm(document.root, this.schema),
      plugins: [...this.plugins],
    });
    this.emitChange();
  }

  /** 导出当前文档（保留载入时的 metadata 与 schemaVersion） */
  getDocument(): BookDocument {
    return {
      schemaVersion: this.schemaVersion,
      metadata: this.metadata,
      root: pmNodeToIr(this.state.doc),
    };
  }

  /** 创建基于当前状态的事务 */
  createTransaction(): Transaction {
    return this.state.tr;
  }

  /** 派发事务：应用后若文档发生变化则广播变更 */
  dispatch(transaction: Transaction): void {
    const docChanged = transaction.docChanged;
    this.state = this.state.apply(transaction);
    if (docChanged) {
      this.emitChange();
    }
  }

  /** 订阅文档变更（返回取消订阅函数） */
  onChange(handler: BookEditorChangeHandler): () => void {
    this.changeHandlers.add(handler);
    return () => {
      this.changeHandlers.delete(handler);
    };
  }

  /** 广播变更（快照当前文档） */
  private emitChange(): void {
    const document = this.getDocument();
    for (const handler of [...this.changeHandlers]) {
      handler(document);
    }
  }
}
