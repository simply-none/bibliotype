/**
 * 交叉引用登记表（label → 目标节点）
 *
 * 正文里写 `{{ref:fig-1}}`，导出时按登记表翻译成目标页码：
 * 内容作者只维护「图 1」这类语义标签，页码交给两遍排版自动算。
 */
import { lookupPage } from './build.js';
import type { CrossReference, PageIndex } from './types.js';

/** 登记表序列化版本 */
export const XREF_SCHEMA_VERSION = '1.0.0';

/** 登记表 JSON 形态 */
export interface CrossReferenceSet {
  /** schema 版本 */
  schemaVersion: string;
  /** 引用条目 */
  references: CrossReference[];
}

/** 交叉引用登记表 */
export class CrossReferenceRegistry {
  private readonly items = new Map<string, CrossReference>();

  /** 批量构造 */
  static from(references: readonly CrossReference[]): CrossReferenceRegistry {
    const registry = new CrossReferenceRegistry();
    registry.registerMany(references);
    return registry;
  }

  /** 条目数量 */
  get size(): number {
    return this.items.size;
  }

  /** 登记单条（标签为空或重复时抛错） */
  register(reference: CrossReference): CrossReference {
    if (!reference.label) {
      throw new RangeError('登记失败：引用标签不能为空。');
    }
    if (!reference.nodeId) {
      throw new RangeError(`登记失败：引用 "${reference.label}" 缺少目标节点 id。`);
    }
    if (this.items.has(reference.label)) {
      throw new RangeError(`登记失败：引用标签 "${reference.label}" 已存在。`);
    }
    this.items.set(reference.label, { ...reference });
    return { ...reference };
  }

  /** 批量登记（任一失败则整体不写入） */
  registerMany(references: readonly CrossReference[]): CrossReference[] {
    const draft = new Map(this.items);
    references.forEach((reference) => {
      if (!reference.label || !reference.nodeId) {
        throw new RangeError('批量登记失败：引用标签与目标节点 id 均不能为空。');
      }
      if (draft.has(reference.label)) {
        throw new RangeError(`批量登记失败：引用标签 "${reference.label}" 已存在。`);
      }
      draft.set(reference.label, { ...reference });
    });
    draft.forEach((value, key) => this.items.set(key, value));
    return references.map((reference) => ({ ...reference }));
  }

  /** 读取条目 */
  get(label: string): CrossReference | undefined {
    const hit = this.items.get(label);
    return hit ? { ...hit } : undefined;
  }

  /** 是否存在 */
  has(label: string): boolean {
    return this.items.has(label);
  }

  /** 删除 */
  remove(label: string): boolean {
    return this.items.delete(label);
  }

  /** 清空 */
  clear(): void {
    this.items.clear();
  }

  /** 列出全部条目（按标签升序，保证确定性） */
  list(): CrossReference[] {
    return [...this.items.values()]
      .sort((left, right) => (left.label < right.label ? -1 : left.label > right.label ? 1 : 0))
      .map((reference) => ({ ...reference }));
  }

  /** 解析标签对应页码（标签不存在或未参与分页时返回 undefined） */
  resolvePage(label: string, index: PageIndex): number | undefined {
    const reference = this.items.get(label);
    if (!reference) {
      return undefined;
    }
    return lookupPage(index, reference.nodeId);
  }

  /** 导出为可序列化集合 */
  toSet(): CrossReferenceSet {
    return { schemaVersion: XREF_SCHEMA_VERSION, references: this.list() };
  }

  /** 序列化为 JSON（确定性） */
  toJSON(): string {
    return JSON.stringify(this.toSet());
  }

  /** 从 JSON 恢复（非法输入抛 TypeError） */
  static fromJSON(json: string): CrossReferenceRegistry {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new TypeError('反序列化失败：交叉引用登记表不是合法 JSON。');
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new TypeError('反序列化失败：交叉引用登记表必须是对象。');
    }
    const references = (parsed as Partial<CrossReferenceSet>).references;
    if (!Array.isArray(references)) {
      throw new TypeError('反序列化失败：缺少 references 数组。');
    }
    const registry = new CrossReferenceRegistry();
    references.forEach((reference) => {
      if (
        typeof reference !== 'object' ||
        reference === null ||
        typeof reference.label !== 'string' ||
        typeof reference.nodeId !== 'string'
      ) {
        throw new TypeError('反序列化失败：引用条目需包含 label 与 nodeId。');
      }
      registry.register(reference as CrossReference);
    });
    return registry;
  }
}
