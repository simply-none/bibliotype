/**
 * 书籍编辑器（无视图编辑状态机）
 *
 * 职责：聚合「schema 注册表 + IR 双向转换 + ProseMirror EditorState」，
 * 提供文档载入 / 导出、事务派发与变更订阅；
 * DOM 视图（prosemirror-view）与框架绑定由 vue / react 封装层负责。
 */
import { createEmptyDocument, type BookDocument, type BookMetadata } from '@bibliotype/core';
import type { Schema } from 'prosemirror-model';
import { EditorState, type Transaction } from 'prosemirror-state';
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
}

/** 文档变更处理器 */
export type BookEditorChangeHandler = (document: BookDocument) => void;

/** 书籍编辑器 */
export class BookEditor {
  private readonly schema: Schema;
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
    this.state = EditorState.create({ doc: irNodeToPm(initial.root, this.schema) });
  }

  /** 当前 ProseMirror 编辑状态（视图层消费） */
  get editorState(): EditorState {
    return this.state;
  }

  /** 编辑器 schema */
  get bookSchema(): Schema {
    return this.schema;
  }

  /** 载入文档（重建编辑状态并广播变更） */
  loadDocument(document: BookDocument): void {
    this.metadata = document.metadata;
    this.schemaVersion = document.schemaVersion;
    this.state = EditorState.create({ doc: irNodeToPm(document.root, this.schema) });
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
