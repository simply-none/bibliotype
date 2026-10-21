/**
 * 统一错误码表（I8）
 *
 * 新增错误必须在此登记，避免字符串漂移；错误码语义与修复建议见 docs/13。
 * CryptoError（docs/10）与 BookPackError（docs/10「.btbook」）的既有稳定码
 * 各自维护在原模块，不在本表重复。
 */

/** 统一错误码表（按域分组的扁平 SCREAMING_SNAKE 码，与既有风格一致） */
export const BIBLIOTYPE_ERROR_CODES = {
  /** 插件重复安装（core / plugin） */
  PLUGIN_CONFLICT: 'PLUGIN_CONFLICT',
  /** 节点类型重复注册（core / node） */
  NODE_TYPE_CONFLICT: 'NODE_TYPE_CONFLICT',
  /** 迁移路径缺失（core / ir） */
  MIGRATION_PATH_MISSING: 'MIGRATION_PATH_MISSING',
  /** 编辑器规格重复注册（editor / schema） */
  EDITOR_SPEC_CONFLICT: 'EDITOR_SPEC_CONFLICT',
  /** HTTP 请求失败（adapter-http，网络错误 status=0） */
  HTTP_REQUEST_FAILED: 'HTTP_REQUEST_FAILED',
} as const;

/** 统一错误码联合 */
export type BibliotypeErrorCode = (typeof BIBLIOTYPE_ERROR_CODES)[keyof typeof BIBLIOTYPE_ERROR_CODES];
