/**
 * @bibliotype/vue 统一导出入口
 */
export { useReader, useReaderBinding } from './use-reader.js';
export type { ReaderBinding, UseReaderReturn } from './use-reader.js';

export { useEditorBinding } from './use-editor.js';
export type { EditorBinding } from './use-editor.js';

export { measureBlockSizes, disposeMeasureSheet } from './pagination-measure.js';
export type { MeasureBlockSizesInput } from './pagination-measure.js';

export { default as BtBookView } from './components/BtBookView.vue';
export { default as BtPager } from './components/BtPager.vue';
export { default as BtToc } from './components/BtToc.vue';
export { default as BtTocItem } from './components/BtTocItem.vue';
export { default as BtEditor } from './components/BtEditor.vue';

export { createBibliotype } from './plugin.js';
