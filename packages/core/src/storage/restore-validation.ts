/**
 * 恢复链路校验选项（H4 整库备份恢复 / C7 历史回滚共用）
 *
 * 恢复对象来自外部（备份包、历史快照），其中可能含插件节点与标记
 * （如 classical 的 `collation-mark`、`judou`）。恢复入口并不掌握插件清单，
 * 若沿用「未知类型即 error」会把合法的古籍文档整本拒之门外。
 *
 * 因此恢复路径统一把**未知节点 / 标记类型降级为 warning**：结构性错误
 * （缺 root、text 落在容器上、id 重复等）仍然阻断，宿主也能从 `warnings`
 * 里看到「这本用了未登记的插件类型」。需要严格时显式传
 * `unknownTypesAsWarning: false`，或直接调用 `validateDocument`。
 */
import {
  validateDocument,
  type ValidateOptions,
  type ValidationResult,
} from '../ir/validate.js';

/** 恢复链路校验选项 */
export interface RestoreValidationOptions {
  /**
   * 透传给 `validateDocument` 的选项
   *
   * 常用：`knownNodeTypes` / `knownMarkTypes` 登记插件类型（与 core 内置类型
   * 合并，不必重复列出 core 类型）；`unknownTypesAsWarning: false` 收紧为严格。
   */
  validateOptions?: ValidateOptions;
}

/** 恢复路径的默认校验口径：未知类型只告警，不阻断恢复 */
export const RESTORE_VALIDATE_DEFAULTS: Readonly<ValidateOptions> = {
  unknownTypesAsWarning: true,
};

/**
 * 按「恢复口径」校验文档
 *
 * @param document 待校验文档（可为 unknown，内部收窄）
 * @param options 覆盖默认口径（`unknownTypesAsWarning` 默认 true）
 * @returns 校验结果；`errors` 为空才允许写入书库
 */
export function validateRestoredDocument(
  document: unknown,
  options?: ValidateOptions,
): ValidationResult {
  return validateDocument(document, { ...RESTORE_VALIDATE_DEFAULTS, ...options });
}
