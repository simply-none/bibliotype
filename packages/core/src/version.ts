/**
 * 包版本常量（日期版本，形式如 26.10.21 / 26.10.21-rc.1）
 *
 * 构建时由 tsup 注入？否——保持显式声明，避免构建工具耦合。
 * 发布时由 scripts/version.mjs 单源写回（与各包 package.json 的 version 同值），
 * scripts/check-version.mjs 在 release:check 中校验一致性，无需手工同步。
 */
export const VERSION = '26.10.25-rc.1';
