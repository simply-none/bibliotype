/**
 * @bibliotype/editor 统一导出入口
 */

/* ---------- 规格注册（D8） ---------- */
export {
  EditorSchemaRegistry,
  EditorSpecConflictError,
  DEFAULT_EDITOR_NAMESPACE,
  DEFAULT_EDITOR_TOP_NODE,
} from './schema-registry.js';
export type {
  EditorNodeSpecEntry,
  EditorMarkSpecEntry,
  EditorSchemaRegistryInit,
  BuildSchemaOptions,
} from './schema-registry.js';

/* ---------- 标准规格表与默认 schema ---------- */
export {
  CORE_EDITOR_NODE_SPECS,
  COMMON_NODE_ATTRS,
  STRUCTURE_NODE_ATTRS,
} from './core-node-specs.js';
export { CORE_EDITOR_MARK_SPECS, COMMON_MARK_ATTRS } from './core-mark-specs.js';
export {
  createDefaultEditorSchemaRegistry,
  buildEditorSchema,
} from './default-schema.js';

/* ---------- 属性映射 ---------- */
export { RAW_ATTRS_ATTR, declaredAttrNames, toPmAttrs, toIrAttrs } from './attr-mapper.js';

/* ---------- IR ⇄ PM 转换 ---------- */
export { irNodeToPm } from './ir-to-pm.js';
export { pmNodeToIr } from './pm-to-ir.js';

/* ---------- 编辑器门面 ---------- */
export { BookEditor } from './editor.js';
export type { BookEditorOptions, BookEditorChangeHandler } from './editor.js';

/* ---------- 编辑命令 ---------- */
export {
  redoCommand,
  redoDepth,
  undoCommand,
  undoDepth,
  toggleMarkOfType,
  toggleMarkByName,
  setHeadingLevel,
  setParagraph,
  setLink,
  unsetLink,
  toggleQuote,
  toggleBulletList,
  toggleOrderedList,
  insertBlockAfterSelection,
  insertBlockOfType,
  insertStructureBlock,
  insertInlineNodeWrapping,
  insertAtomicNode,
  insertImage,
  insertCodeBlock,
  insertMathBlock,
  insertMathInline,
  insertRuby,
  insertFigure,
  insertHorizontalRule,
  PLACEHOLDER_IMAGE_SRC,
  HORIZONTAL_RULE_VARIANT,
  insertPageBreak,
  PAGE_BREAK_VARIANT,
  insertTable,
  tableAddRow,
  tableAddColumn,
  tableDeleteRow,
  tableDeleteColumn,
  setNodeAttrs,
  setMarkAttrs,
  setBlockStyleId,
  getBlockStyleId,
  STRUCTURE_BLOCK_TYPE_NAMES,
} from './commands.js';
export type { FigureOptions } from './commands.js';

/* ---------- 选区转换为容器（「替换为」） ---------- */
export { replaceSelectionWithContainer } from './selection-convert.js';
export type { ReplaceContainerOptions, ReplaceIdOwner } from './selection-convert.js';

/* ---------- 编辑态查找替换 ---------- */
export {
  escapeRegExp,
  buildSearchRegExp,
  findTextMatches,
  findNextMatch,
  selectRange,
  replaceSelectionWith,
  replaceMatch,
  replaceAll,
} from './search.js';
export type { TextMatch, EditorSearchOptions } from './search.js';

/* ---------- 插件与键位 ---------- */
export { createBookEditorKeymap, createBookEditorPlugins } from './plugins.js';

/* ---------- 状态查询（工具栏反显 / 快捷键互斥） ---------- */
export {
  getActiveMarkNames,
  isMarkActive,
  getActiveMarkAttrs,
  getActiveBlockInfo,
  getSelectionInfo,
} from './state-query.js';
export type { BlockAncestor, ActiveBlockInfo, SelectionInfo } from './state-query.js';

/* ---------- Markdown 快捷输入（input rules） ---------- */
export {
  INPUT_RULE_KINDS,
  matchInputRule,
  applyInputRules,
  createInputRulesPlugin,
} from './input-rules.js';
export type {
  InputRuleKind,
  InputRuleMatch,
  BookInputRulesOptions,
} from './input-rules.js';

/* ---------- 粘贴增强（Markdown → PM） ---------- */
export {
  looksLikeMarkdown,
  parseInlineToNodes,
  markdownToNodes,
  markdownToFragment,
} from './markdown.js';
export { createPasteMarkdownPlugin, buildPasteSlice } from './paste.js';
