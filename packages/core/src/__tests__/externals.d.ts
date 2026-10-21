/**
 * 测试对 scripts/ 下 .mjs 脚本模块的导入声明（I6 version-sync 测试使用）。
 * 仓内脚本为纯 Node ESM，无类型定义文件；此处通配声明为 any 以通过 typecheck。
 */
declare module '*.mjs';
