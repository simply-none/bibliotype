/**
 * Markdown 快捷输入（input rules）
 *
 * 在**块首**输入触发串即转换为对应节点，行为与主流编辑器一致：
 *
 * | 输入 | 结果 |
 * | --- | --- |
 * | `# ` ~ `###### ` | 标题 1~6 |
 * | `> ` | 引用块 |
 * | `- ` / `* ` / `+ ` | 无序列表 |
 * | `1. ` | 有序列表 |
 * | ` ```ts ` | 代码块（language = ts） |
 * | `---` / `***` | 分隔符（break 节点，variant = hr） |
 *
 * 实现为 `appendTransaction` 插件：只依赖 EditorState，**不需要 EditorView**——
 * 与无视图编辑状态机（BookEditor）和自绘分页画布（BtEditor）都能配合；
 * 也不引入 `prosemirror-inputrules` 依赖。
 */
import { NODE_TYPES } from '@bibliotype/core';
import { wrapIn } from 'prosemirror-commands';
import type { NodeType, Schema } from 'prosemirror-model';
import { wrapInList } from 'prosemirror-schema-list';
import { Plugin, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';

/** 快捷输入种类 */
export const INPUT_RULE_KINDS = {
  /** 标题 */
  HEADING: 'heading',
  /** 引用块 */
  QUOTE: 'quote',
  /** 无序列表 */
  BULLET_LIST: 'bullet-list',
  /** 有序列表 */
  ORDERED_LIST: 'ordered-list',
  /** 代码块 */
  CODE_BLOCK: 'code-block',
  /** 分隔符 */
  HORIZONTAL_RULE: 'hr',
} as const;

/** 种类联合 */
export type InputRuleKind = (typeof INPUT_RULE_KINDS)[keyof typeof INPUT_RULE_KINDS];

/** 开关选项（缺省全部启用） */
export interface BookInputRulesOptions {
  /** 标题 `# ` */
  headings?: boolean;
  /** 引用 `> ` */
  quote?: boolean;
  /** 列表 `- ` / `1. ` */
  lists?: boolean;
  /** 代码块 ` ``` ` */
  codeBlock?: boolean;
  /** 分隔符 `---` */
  horizontalRule?: boolean;
}

/** 命中结果 */
export interface InputRuleMatch {
  /** 命中的规则种类 */
  kind: InputRuleKind;
  /** 需要删除的块首字符数（含触发空格） */
  prefixLength: number;
  /** 标题级别（heading） */
  headingLevel?: number;
  /** 代码语言（code-block） */
  language?: string;
}

const HEADING_PATTERN = /^(#{1,6})[ \u3000]$/;
const QUOTE_PATTERN = /^>[ \u3000]$/;
const BULLET_PATTERN = /^[-*+][ \u3000]$/;
const ORDERED_PATTERN = /^1\.[ \u3000]$/;
const FENCE_PATTERN = /^```([A-Za-z0-9_+-]*)[ \u3000]$/;
const HR_PATTERN = /^(?:-{3,}|\*{3,})$/;

/**
 * 判定块首文本是否命中快捷输入
 *
 * @param textBefore 块首到光标的文本（不含光标之后的字符）
 */
export function matchInputRule(
  textBefore: string,
  options: BookInputRulesOptions = {},
): InputRuleMatch | undefined {
  if (options.headings !== false) {
    const heading = HEADING_PATTERN.exec(textBefore);
    if (heading) {
      return {
        kind: INPUT_RULE_KINDS.HEADING,
        prefixLength: heading[0].length,
        headingLevel: (heading[1] ?? '#').length,
      };
    }
  }
  if (options.codeBlock !== false) {
    const fence = FENCE_PATTERN.exec(textBefore);
    if (fence) {
      return {
        kind: INPUT_RULE_KINDS.CODE_BLOCK,
        prefixLength: fence[0].length,
        language: fence[1] ?? '',
      };
    }
  }
  if (options.horizontalRule !== false) {
    const hr = HR_PATTERN.exec(textBefore);
    if (hr) {
      return { kind: INPUT_RULE_KINDS.HORIZONTAL_RULE, prefixLength: hr[0].length };
    }
  }
  if (options.quote !== false && QUOTE_PATTERN.test(textBefore)) {
    return { kind: INPUT_RULE_KINDS.QUOTE, prefixLength: textBefore.length };
  }
  if (options.lists !== false) {
    if (ORDERED_PATTERN.test(textBefore)) {
      return { kind: INPUT_RULE_KINDS.ORDERED_LIST, prefixLength: textBefore.length };
    }
    if (BULLET_PATTERN.test(textBefore)) {
      return { kind: INPUT_RULE_KINDS.BULLET_LIST, prefixLength: textBefore.length };
    }
  }
  return undefined;
}

/** 命令执行器（与 prosemirror-commands 的 dispatch 签名一致） */
type CommandRunner = (
  state: EditorState,
  dispatch: (tr: Transaction) => void,
) => boolean;

/**
 * 先删前缀，再在新状态上执行包裹类命令，返回累积事务
 *
 * 命令产出的事务源自「删前缀后的中间状态」，不能直接返回给 appendTransaction
 * （其基准文档须为当前状态），因此把命令的 steps 依次追加到 baseTr 上。
 */
function runWrapCommand(
  state: EditorState,
  baseTr: Transaction,
  run: CommandRunner,
): Transaction | undefined {
  const intermediate = state.apply(baseTr);
  let result: Transaction | undefined;
  const ok = run(intermediate, (tr) => {
    result = tr;
  });
  if (!ok || result === undefined) {
    return undefined;
  }
  let combined = baseTr;
  for (const step of result.steps) {
    combined = combined.step(step);
  }
  // 命令的选区绑定在中间文档实例上，需在合并后的文档中重建
  const sel = result.selection;
  if (sel.empty) {
    combined.setSelection(TextSelection.create(combined.doc, sel.from));
  }
  return combined;
}

/** 取节点类型（未注册时返回 undefined，规则静默跳过） */
function nodeTypeOf(schema: Schema, name: string): NodeType | undefined {
  const nodes = schema.nodes as Record<string, NodeType | undefined>;
  return nodes[name];
}

/**
 * 在给定状态上尝试应用快捷输入
 *
 * 返回需要追加到当前事务之后的事务；未命中返回 `undefined`。
 * 只处理空选区（光标）且光标位于文本块内的情形。
 */
export function applyInputRules(
  state: EditorState,
  options: BookInputRulesOptions = {},
): Transaction | undefined {
  const { selection } = state;
  if (!selection.empty) {
    return undefined;
  }
  const $pos = selection.$from;
  const block = $pos.parent;
  if (!block.isTextblock) {
    return undefined;
  }
  const textBefore = block.textBetween(0, $pos.parentOffset, undefined, '\ufffc');
  const match = matchInputRule(textBefore, options);
  if (!match) {
    return undefined;
  }

  const blockStart = $pos.before($pos.depth);

  if (match.kind === INPUT_RULE_KINDS.HORIZONTAL_RULE) {
    const breakType = nodeTypeOf(state.schema, NODE_TYPES.BREAK);
    const paragraphType = nodeTypeOf(state.schema, NODE_TYPES.PARAGRAPH);
    if (breakType === undefined || paragraphType === undefined) {
      return undefined;
    }
    const brk = breakType.create({ variant: 'hr' });
    const tr = state.tr.replaceWith(blockStart, blockStart + block.nodeSize, brk);
    const afterBreak = blockStart + brk.nodeSize;
    // 分隔符位于末块时补一个空段落承接光标，否则后续键入无处落点
    if (tr.doc.resolve(afterBreak).nodeAfter === null) {
      tr.insert(afterBreak, paragraphType.create());
    }
    tr.setSelection(TextSelection.near(tr.doc.resolve(afterBreak + 1), 1));
    return tr;
  }

  const baseTr = state.tr.delete(blockStart + 1, blockStart + 1 + match.prefixLength);

  if (match.kind === INPUT_RULE_KINDS.HEADING) {
    const headingType = nodeTypeOf(state.schema, NODE_TYPES.HEADING);
    if (headingType === undefined) {
      return undefined;
    }
    return baseTr.setNodeMarkup(blockStart, headingType, {
      ...block.attrs,
      level: match.headingLevel ?? 1,
    });
  }

  if (match.kind === INPUT_RULE_KINDS.CODE_BLOCK) {
    const codeType = nodeTypeOf(state.schema, NODE_TYPES.CODE_BLOCK);
    if (codeType === undefined) {
      return undefined;
    }
    return baseTr.setNodeMarkup(blockStart, codeType, {
      ...block.attrs,
      language: match.language ? match.language : null,
    });
  }

  if (match.kind === INPUT_RULE_KINDS.QUOTE) {
    const quoteType = nodeTypeOf(state.schema, NODE_TYPES.QUOTE);
    if (quoteType === undefined) {
      return undefined;
    }
    return runWrapCommand(state, baseTr, (inner, dispatch) => wrapIn(quoteType)(inner, dispatch));
  }

  const listType = nodeTypeOf(state.schema, NODE_TYPES.LIST);
  if (listType === undefined) {
    return undefined;
  }
  const ordered = match.kind === INPUT_RULE_KINDS.ORDERED_LIST;
  return runWrapCommand(state, baseTr, (inner, dispatch) =>
    wrapInList(listType, { ordered })(inner, dispatch),
  );
}

/**
 * 创建快捷输入插件
 *
 * 以 `appendTransaction` 实现：任何文档变更后检查一次光标处是否符合触发串，
 * 命中则追加转换事务。对「粘贴后恰好构成触发串」同样生效（与输入一致）。
 */
export function createInputRulesPlugin(options: BookInputRulesOptions = {}): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) {
        return null;
      }
      return applyInputRules(newState, options) ?? null;
    },
  });
}
