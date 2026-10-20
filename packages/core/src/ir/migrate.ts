/**
 * IR schema 版本迁移
 *
 * `BookDocument.schemaVersion` 用于标识结构版本。结构发生不兼容变更时，
 * 旧数据不能直接进入管线，必须先按「逐级迁移」补齐：
 *
 *   '0.0.0' --step--> '0.1.0' --step--> '0.2.0'
 *
 * 约定：
 * - 每个 step 只负责相邻两级之间的转换（纯函数，输入输出均为普通对象）；
 * - 迁移链必须连通，缺环时抛 `MigrationPathError`（不静默返回半成品）；
 * - 迁移完成后回填 schemaVersion 并做一次结构校验，问题随结果返回；
 * - 内置步骤表默认为空：`0.1.0` 是当前基线，历史数据的迁移步骤由调用方按需注册。
 */
import type { BookDocument } from './document.js';
import { IR_SCHEMA_VERSION } from './document.js';
import type { DocumentIssue } from './validate.js';
import { validateDocument } from './validate.js';

/** 无版本号的历史数据按此版本处理 */
export const LEGACY_SCHEMA_VERSION = '0.0.0';

/** 迁移步骤输入输出形态（普通对象，便于处理任意历史结构） */
export type RawBookDocument = Record<string, unknown>;

/** 单步迁移 */
export interface MigrationStep {
  /** 源版本 */
  from: string;
  /** 目标版本 */
  to: string;
  /** 步骤说明（用于日志与文档） */
  description?: string;
  /** 转换函数（纯函数，不得修改入参） */
  migrate: (document: RawBookDocument) => RawBookDocument;
}

/** 迁移路径错误 */
export class MigrationPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationPathError';
  }
}

/** 内置迁移步骤（0.1.0 → 0.2.0 为 A6 契约升级，后续步骤按需追加） */
export const BUILTIN_MIGRATIONS: readonly MigrationStep[] = [
  {
    from: '0.1.0',
    to: '0.2.0',
    description:
      '0.2.0 引入分栏 / 页眉页脚 / 条件内容：缺省 columns=1 为隐式语义，旧文档无需改写。',
    // 无需改写：columns 缺省视为 1，页眉页脚与条件内容为可选新增，旧结构天然合法。
    migrate: (document) => document,
  },
  {
    from: '0.2.0',
    to: '0.3.0',
    description: '0.3.0 引入索引词标记 index-term：纯新增标记，旧文档无需改写。',
    // 无需改写：未使用索引词的文档结构不变；新增标记向后兼容。
    migrate: (document) => document,
  },
];

/** 迁移选项 */
export interface MigrateOptions {
  /** 目标版本（缺省为当前 IR_SCHEMA_VERSION） */
  targetVersion?: string;
  /** 追加的自定义步骤（与内置步骤合并） */
  steps?: readonly MigrationStep[];
  /** 是否在迁移后执行结构校验（缺省 true） */
  validate?: boolean;
  /** 传给校验的额外允许类型（插件节点 / 标记） */
  knownNodeTypes?: readonly string[];
  knownMarkTypes?: readonly string[];
}

/** 迁移结果 */
export interface MigrateResult {
  /** 迁移后的文档 */
  document: BookDocument;
  /** 已执行的步骤（按顺序，空数组表示无需迁移） */
  applied: MigrationStep[];
  /** 源版本 */
  fromVersion: string;
  /** 目标版本 */
  toVersion: string;
  /** 迁移后的结构校验问题（仅当 validate !== false） */
  issues: DocumentIssue[];
}

/** 读取文档版本（缺失按 LEGACY_SCHEMA_VERSION 处理） */
export function readSchemaVersion(document: unknown): string {
  if (typeof document === 'object' && document !== null) {
    const value = (document as RawBookDocument).schemaVersion;
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return LEGACY_SCHEMA_VERSION;
}

/** 查找从 from 出发的下一跳（同源多分支时取首个注册项） */
function nextStep(steps: readonly MigrationStep[], from: string): MigrationStep | undefined {
  return steps.find((step) => step.from === from);
}

/**
 * 迁移文档到目标版本
 *
 * @throws MigrationPathError 迁移链不通（无可用步骤）
 * @throws TypeError 文档不是对象
 */
export function migrateDocument(document: unknown, options: MigrateOptions = {}): MigrateResult {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new TypeError('迁移失败：文档必须是对象。');
  }
  const targetVersion = options.targetVersion ?? IR_SCHEMA_VERSION;
  const steps = [...BUILTIN_MIGRATIONS, ...(options.steps ?? [])];
  const fromVersion = readSchemaVersion(document);

  let current = document as RawBookDocument;
  let version = fromVersion;
  const applied: MigrationStep[] = [];
  const guard = steps.length + 1;

  while (version !== targetVersion) {
    const step = nextStep(steps, version);
    if (!step || applied.length >= guard) {
      throw new MigrationPathError(
        `迁移失败：缺少 ${version} → ${targetVersion} 的迁移步骤，请在 steps 中注册。`,
      );
    }
    current = { ...step.migrate(current), schemaVersion: step.to };
    applied.push(step);
    version = step.to;
  }

  const migrated = { ...current, schemaVersion: targetVersion } as unknown as BookDocument;
  const issues =
    options.validate === false
      ? []
      : validateDocument(migrated, {
          knownNodeTypes: options.knownNodeTypes,
          knownMarkTypes: options.knownMarkTypes,
        }).issues;

  return {
    document: migrated,
    applied,
    fromVersion,
    toVersion: targetVersion,
    issues,
  };
}
