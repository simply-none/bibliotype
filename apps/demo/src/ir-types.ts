/**
 * Demo 文档校验白名单（D5 遗留修复）
 *
 * 含古籍插件节点（`collation-mark` / `double-note` 等）与标记（`judou` / `proper-name`
 * 等）的合法文档，在「整库备份恢复 / 历史版本回滚」时不再被误判为非法文档。
 *
 * 机制：恢复链路默认把未知类型降级为 warning；把古籍类型登记到 `knownNodeTypes`
 * / `knownMarkTypes`，校验便「认识」这些类型，连 warning 都不会产生。注册不影响
 * 任何结构性校验（拼写错误的类型仍会被检出）。
 *
 * 注意：本文件是 demo 对 `@bibliotype/classical` 的可选依赖边界，不把古籍类型
 * 下沉到 core / vue。
 */
import type { ValidateOptions } from '@bibliotype/core';
import { CLASSICAL_MARK_TYPES, CLASSICAL_NODE_TYPES } from '@bibliotype/classical';

/** 演示用文档校验选项：认识全部古籍节点与标记类型 */
export const DEMO_VALIDATE_OPTIONS: ValidateOptions = {
  knownNodeTypes: Object.values(CLASSICAL_NODE_TYPES),
  knownMarkTypes: Object.values(CLASSICAL_MARK_TYPES),
};
