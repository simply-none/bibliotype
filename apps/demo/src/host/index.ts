/**
 * Web 宿主入口（缺省）
 *
 * 通用代码统一 `import { host } from '../host/index.js'`；
 * 复制到 Electron 项目时，本文件被 `electron.ts` 的内容覆盖（入口替换为 electron 实现），
 * 通用代码零分叉。
 */
export * from './web.js';
