/**
 * @bibliotype/vue 统一导出入口
 */
export { useReader, useReaderBinding } from './use-reader.js';
export type { ReaderBinding, UseReaderReturn } from './use-reader.js';

export { default as BtBookView } from './components/BtBookView.vue';
export { default as BtPager } from './components/BtPager.vue';
export { default as BtToc } from './components/BtToc.vue';
export { default as BtTocItem } from './components/BtTocItem.vue';

export { createBibliotype } from './plugin.js';
