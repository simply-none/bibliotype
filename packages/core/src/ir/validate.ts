/**
 * IR 文档结构校验
 *
 * `isBookDocument` 只做浅层守卫（能不能当 BookDocument 用），本模块回答更严的问题：
 * **这份文档在结构上是否合法、能否安全进入编辑 / 分页 / 导出管线**。
 *
 * 校验覆盖：
 * - 顶层形态（schemaVersion / metadata.title / root）；
 * - 节点类型是否在允许集合内（core 内置 + 调用方注入的插件类型，如 classical）；
 * - 文本节点与容器节点的形态互斥（`text` 只能在叶子、容器不得携带 `text`）；
 * - 标记类型是否允许、是否只出现在文本节点上；
 * - 属性值类型（string / number / boolean）；
 * - 节点 id 唯一性（协同与锚点依赖）。
 *
 * 纯函数、无副作用；不抛错，问题以 issue 列表返回，由调用方决定拦截或告警。
 */
import { NODE_TYPES, MARK_TYPES } from './node-types.js';
import { isValidConditionExpression } from './condition.js';
import type { BookNode } from './nodes.js';
import type { NodeId } from './types.js';

/** 问题代码常量 */
export const DOCUMENT_ISSUE_CODES = {
  /** 顶层结构非法（非对象 / 缺字段 / root 类型错误） */
  INVALID_STRUCTURE: 'invalid-structure',
  /** 未知节点类型（未注册） */
  UNKNOWN_NODE_TYPE: 'unknown-node-type',
  /** 未知标记类型（未注册） */
  UNKNOWN_MARK_TYPE: 'unknown-mark-type',
  /** 容器节点上出现 text */
  TEXT_ON_CONTAINER: 'text-on-container',
  /** 文本节点缺少字符串 text */
  INVALID_TEXT: 'invalid-text',
  /** children 非数组 */
  INVALID_CHILDREN: 'invalid-children',
  /** 节点 id 重复 */
  DUPLICATE_NODE_ID: 'duplicate-node-id',
  /** 属性值类型非法 */
  INVALID_ATTR_VALUE: 'invalid-attr-value',
  /** 标记出现在非文本节点上 */
  MARK_ON_CONTAINER: 'mark-on-container',
  /** schemaVersion 与期望不一致 */
  SCHEMA_VERSION_MISMATCH: 'schema-version-mismatch',
} as const;

/** 问题代码联合 */
export type DocumentIssueCode =
  (typeof DOCUMENT_ISSUE_CODES)[keyof typeof DOCUMENT_ISSUE_CODES];

/** 问题严重级别 */
export type DocumentIssueSeverity = 'error' | 'warning';

/** 单条校验问题 */
export interface DocumentIssue {
  /** 问题代码（可编程分支） */
  code: DocumentIssueCode;
  /** 严重级别（error 表示管线不可安全消费） */
  severity: DocumentIssueSeverity;
  /** 节点路径，如 `root.children[0].children[2]` */
  path: string;
  /** 相关节点 id（若有） */
  nodeId?: NodeId;
  /** 人能读懂的中文说明（含修复指向） */
  message: string;
}

/** 校验选项 */
export interface ValidateOptions {
  /** 额外允许的节点类型（插件注册的类型，如 classical 的 13 个节点） */
  knownNodeTypes?: readonly string[];
  /** 额外允许的标记类型（插件注册的标记） */
  knownMarkTypes?: readonly string[];
  /** 期望的 schemaVersion（不一致记 error；缺省不校验版本） */
  expectedSchemaVersion?: string;
  /** 是否要求结构节点必须携带 id（缺省 false，仅产 warning） */
  requireNodeIds?: boolean;
  /** 出现未知类型时是否降级为 warning（缺省 false，记 error） */
  unknownTypesAsWarning?: boolean;
}

/** 校验结果 */
export interface ValidationResult {
  /** 无 error 级问题即为 true */
  ok: boolean;
  /** 全部问题（按遍历顺序） */
  issues: DocumentIssue[];
  /** error 级问题 */
  errors: DocumentIssue[];
  /** warning 级问题 */
  warnings: DocumentIssue[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAttrValue(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * 校验 IR 文档
 *
 * @param document 待校验数据（允许传入 unknown，函数内部做形态收窄）
 * @param options 允许的插件类型、期望版本等
 */
export function validateDocument(
  document: unknown,
  options: ValidateOptions = {},
): ValidationResult {
  const issues: DocumentIssue[] = [];
  const knownNodes = new Set<string>([
    ...Object.values(NODE_TYPES),
    ...(options.knownNodeTypes ?? []),
  ]);
  const knownMarks = new Set<string>([
    ...Object.values(MARK_TYPES),
    ...(options.knownMarkTypes ?? []),
  ]);
  const unknownSeverity: DocumentIssueSeverity = options.unknownTypesAsWarning
    ? 'warning'
    : 'error';

  const push = (
    code: DocumentIssueCode,
    path: string,
    message: string,
    severity: DocumentIssueSeverity = 'error',
    nodeId?: NodeId,
  ): void => {
    const issue: DocumentIssue = { code, severity, path, message };
    if (nodeId !== undefined) {
      issue.nodeId = nodeId;
    }
    issues.push(issue);
  };

  if (!isPlainObject(document)) {
    push(
      DOCUMENT_ISSUE_CODES.INVALID_STRUCTURE,
      '',
      '文档必须是对象：请传入 BookDocument（含 schemaVersion / metadata / root）。',
    );
    return finish(issues);
  }

  const schemaVersion = document.schemaVersion;
  if (typeof schemaVersion !== 'string' || schemaVersion.length === 0) {
    push(
      DOCUMENT_ISSUE_CODES.INVALID_STRUCTURE,
      'schemaVersion',
      '缺少 schemaVersion：请用 migrateDocument 补齐版本后再校验。',
    );
  } else if (
    options.expectedSchemaVersion !== undefined &&
    schemaVersion !== options.expectedSchemaVersion
  ) {
    push(
      DOCUMENT_ISSUE_CODES.SCHEMA_VERSION_MISMATCH,
      'schemaVersion',
      `schemaVersion 为 ${schemaVersion}，期望 ${options.expectedSchemaVersion}：请先执行 migrateDocument。`,
    );
  }

  const metadata = document.metadata;
  if (!isPlainObject(metadata) || typeof metadata.title !== 'string') {
    push(
      DOCUMENT_ISSUE_CODES.INVALID_STRUCTURE,
      'metadata',
      'metadata.title 必须为字符串：请补齐书目标题。',
    );
  }

  const root = document.root;
  if (!isPlainObject(root)) {
    push(
      DOCUMENT_ISSUE_CODES.INVALID_STRUCTURE,
      'root',
      '缺少 root 节点：请用 createEmptyDocument 构造文档。',
    );
    return finish(issues);
  }

  const seenIds = new Set<string>();

  const visit = (value: unknown, path: string): void => {
    if (!isPlainObject(value)) {
      push(
        DOCUMENT_ISSUE_CODES.INVALID_STRUCTURE,
        path,
        '节点必须是对象：检查 children 中是否混入了 null 或字符串。',
      );
      return;
    }
    const node = value as unknown as BookNode;
    const nodeId = typeof node.id === 'string' ? node.id : undefined;

    if (typeof node.type !== 'string' || node.type.length === 0) {
      push(
        DOCUMENT_ISSUE_CODES.INVALID_STRUCTURE,
        path,
        '节点缺少 type：每个节点必须有语义类型。',
        'error',
        nodeId,
      );
    } else if (!knownNodes.has(node.type)) {
      push(
        DOCUMENT_ISSUE_CODES.UNKNOWN_NODE_TYPE,
        path,
        `未知节点类型 "${node.type}"：请在 NodeTypeRegistry 注册，或把插件类型传入 knownNodeTypes。`,
        unknownSeverity,
        nodeId,
      );
    }

    if (nodeId !== undefined) {
      if (seenIds.has(nodeId)) {
        push(
          DOCUMENT_ISSUE_CODES.DUPLICATE_NODE_ID,
          path,
          `节点 id "${nodeId}" 重复：锚点与协同依赖 id 唯一，请重新分配。`,
          'error',
          nodeId,
        );
      } else {
        seenIds.add(nodeId);
      }
    } else if (options.requireNodeIds) {
      push(
        DOCUMENT_ISSUE_CODES.INVALID_STRUCTURE,
        path,
        '结构节点缺少 id：批注 / 书签 / 交叉引用需要稳定 id。',
        'warning',
      );
    }

    if (node.attrs !== undefined) {
      if (!isPlainObject(node.attrs)) {
        push(
          DOCUMENT_ISSUE_CODES.INVALID_STRUCTURE,
          `${path}.attrs`,
          'attrs 必须是对象。',
          'error',
          nodeId,
        );
      } else {
        for (const [key, attrValue] of Object.entries(node.attrs)) {
          if (!isAttrValue(attrValue)) {
            push(
              DOCUMENT_ISSUE_CODES.INVALID_ATTR_VALUE,
              `${path}.attrs.${key}`,
              `属性 "${key}" 的值必须是 string / number / boolean：复杂数据请拆成多个属性或子节点。`,
              'error',
              nodeId,
            );
          }
        }
      }
    }

    /* A6：分栏数只能是 1~3 的整数（0 / 4+ 请在布局选项里配置） */
    if (node.type === NODE_TYPES.CHAPTER || node.type === NODE_TYPES.SECTION) {
      const columns = node.attrs?.columns;
      if (
        columns !== undefined &&
        (typeof columns !== 'number' || !Number.isInteger(columns) || columns < 1 || columns > 3)
      ) {
        push(
          DOCUMENT_ISSUE_CODES.INVALID_ATTR_VALUE,
          `${path}.attrs.columns`,
          'columns 必须是 1~3 的整数：超出范围的版式请改用布局选项。',
          'error',
          nodeId,
        );
      }
    }

    /* A6：条件内容必须有合法表达式且非空 */
    if (node.type === NODE_TYPES.CONDITION) {
      const when = node.attrs?.when;
      if (typeof when !== 'string' || !isValidConditionExpression(when)) {
        push(
          DOCUMENT_ISSUE_CODES.INVALID_ATTR_VALUE,
          `${path}.attrs.when`,
          'condition.when 必须是合法表达式（如 platform=epub&role=teacher）或空串。',
          'error',
          nodeId,
        );
      }
      if (node.children === undefined || node.children.length === 0) {
        push(
          DOCUMENT_ISSUE_CODES.INVALID_STRUCTURE,
          `${path}.children`,
          'condition 不能为空：请放入至少一个块节点，或删除该容器。',
          'error',
          nodeId,
        );
      }
    }

    const isLeafText = node.type === NODE_TYPES.TEXT;

    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks)) {
        push(
          DOCUMENT_ISSUE_CODES.INVALID_STRUCTURE,
          `${path}.marks`,
          'marks 必须是数组。',
          'error',
          nodeId,
        );
      } else {
        if (!isLeafText) {
          push(
            DOCUMENT_ISSUE_CODES.MARK_ON_CONTAINER,
            `${path}.marks`,
            '只有文本节点可以携带 marks：容器上的标记请下移到其文本子节点。',
            'error',
            nodeId,
          );
        }
        node.marks.forEach((mark, index) => {
          const markType = isPlainObject(mark) ? mark.type : undefined;
          if (typeof markType !== 'string' || !knownMarks.has(markType)) {
            push(
              DOCUMENT_ISSUE_CODES.UNKNOWN_MARK_TYPE,
              `${path}.marks[${index}]`,
              `未知标记类型 "${String(markType)}"：请注册标记或传入 knownMarkTypes。`,
              unknownSeverity,
              nodeId,
            );
          }
        });
      }
    }

    const hasChildren = node.children !== undefined;
    if (hasChildren && !Array.isArray(node.children)) {
      push(
        DOCUMENT_ISSUE_CODES.INVALID_CHILDREN,
        `${path}.children`,
        'children 必须是数组。',
        'error',
        nodeId,
      );
      return;
    }

    if (isLeafText) {
      if (typeof node.text !== 'string') {
        push(
          DOCUMENT_ISSUE_CODES.INVALID_TEXT,
          `${path}.text`,
          '文本节点必须携带字符串 text：空文本请删除该节点。',
          'error',
          nodeId,
        );
      }
      if (hasChildren && (node.children as BookNode[]).length > 0) {
        push(
          DOCUMENT_ISSUE_CODES.INVALID_CHILDREN,
          `${path}.children`,
          '文本节点不能再有 children：请把文本拆成兄弟节点。',
          'error',
          nodeId,
        );
      }
      return;
    }

    if (node.text !== undefined) {
      push(
        DOCUMENT_ISSUE_CODES.TEXT_ON_CONTAINER,
        `${path}.text`,
        '容器节点不得直接携带 text：请改为 "容器 + 文本子节点"（编辑往返会把容器直挂文本规范化）。',
        'error',
        nodeId,
      );
    }

    (node.children ?? []).forEach((child, index) => {
      visit(child, `${path}.children[${index}]`);
    });
  };

  if (root.type !== NODE_TYPES.BOOK) {
    push(
      DOCUMENT_ISSUE_CODES.INVALID_STRUCTURE,
      'root.type',
      `根节点 type 必须为 "${NODE_TYPES.BOOK}"，实际为 "${String(root.type)}"。`,
    );
  }
  visit(root, 'root');

  /* A6：页眉页脚必须是 book 直接子节点，且每本书各至多一个 */
  const chromeCounts = new Map<string, number>();
  const scanChrome = (node: BookNode, depth: number): void => {
    if (node.type === NODE_TYPES.PAGE_HEADER || node.type === NODE_TYPES.PAGE_FOOTER) {
      chromeCounts.set(node.type, (chromeCounts.get(node.type) ?? 0) + 1);
      if (depth !== 1) {
        push(
          DOCUMENT_ISSUE_CODES.INVALID_STRUCTURE,
          `root.${node.type}`,
          `${node.type} 必须是 book 的直接子节点（每本书至多一个）。`,
          'error',
          typeof node.id === 'string' ? node.id : undefined,
        );
      }
    }
    for (const child of node.children ?? []) scanChrome(child, depth + 1);
  };
  scanChrome(root as unknown as BookNode, 0);
  for (const [type, count] of chromeCounts) {
    if (count > 1) {
      push(
        DOCUMENT_ISSUE_CODES.INVALID_STRUCTURE,
        `root.${type}`,
        `${type} 每本书至多一个，实际 ${count} 个。`,
        'error',
      );
    }
  }

  return finish(issues);
}

/** 汇总校验结果 */
function finish(issues: DocumentIssue[]): ValidationResult {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return { ok: errors.length === 0, issues, errors, warnings };
}
