/**
 * @bibliotype/classical/editor 子路径入口（D8）
 *
 * 与主入口分离：不需要编辑能力的场景（纯阅读 / 导出）无需加载
 * ProseMirror 相关代码与依赖。
 */
export {
  CLASSICAL_EDITOR_NODE_SPECS,
  CLASSICAL_EDITOR_MARK_SPECS,
} from './editor-specs.js';
export {
  registerClassicalEditorSpecs,
  buildClassicalEditorSchema,
} from './editor-registration.js';
export {
  toggleProperName,
  toggleBookTitle,
  toggleCircleEmphasis,
  toggleVariant,
  toggleNoteRef,
  toggleTaboo,
  applyJudouSuggestions,
  applyProperNameSuggestions,
  removeSuggestionMarks,
  commitJudouAsText,
  toggleInlineNote,
  toggleVariantChar,
  toggleTabooChar,
  insertDoubleNote,
  insertHeadNote,
  insertCollationNote,
  renumberCollationNotes,
  pairCollation,
  unpairCollation,
  insertTailNote,
  insertImprint,
  insertColophon,
  insertBorderFrame,
  insertFishTail,
  insertSeal,
  insertCollationSymbol,
  replaceWithDoubleNote,
  replaceWithHeadNote,
  replaceWithTailNote,
  replaceWithCollationNote,
  replaceWithImprint,
  replaceWithColophon,
  replaceWithBorderFrame,
} from './editor-commands.js';
export type {
  CommitJudouOptions,
  JudouSuggestionInput,
  ProperNameSuggestionInput,
  RemoveSuggestionMarksOptions,
} from './editor-commands.js';
