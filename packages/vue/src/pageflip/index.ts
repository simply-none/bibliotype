/**
 * @bibliotype/vue/pageflip 子入口：仿真翻页引擎的 Vue 绑定。
 *
 * 独立于主入口（不牵涉 prosemirror / reader 图），供翻页场景轻量引入：
 * `import { usePageflip } from '@bibliotype/vue/pageflip'`
 */
export { usePageflip } from './use-pageflip.js';
export type { PageflipProviderEntry, UsePageflipOptions } from './use-pageflip.js';
