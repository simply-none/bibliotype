/**
 * 协作者在线状态（简化 Awareness）
 *
 * POC 边界：本模块仅管理「本地用户身份」；
 * 完整的多端光标/选区 Awareness 协议在 editor 集成阶段
 * 基于 y-protocols/awareness 扩展，Provider 负责转发。
 */

/** 协作者身份 */
export interface CollabUser {
  /** 显示名（如「钱大昕」） */
  name: string;
  /** 标识色（光标/批注框） */
  color: string;
}

/** 默认协作者配色（古籍雅色系） */
export const DEFAULT_USER_COLORS = [
  '#8c5a2b', // 赭石
  '#3d6b4f', // 苍绿
  '#5a5a8c', // 黛蓝
  '#8c3d3d', // 胭脂
  '#6b5a3d', // 秋香
] as const;

/** 生成默认用户（按序号取色） */
export function createDefaultUser(index = 0): CollabUser {
  const color = DEFAULT_USER_COLORS[index % DEFAULT_USER_COLORS.length]
    ?? DEFAULT_USER_COLORS[0];
  return { name: `校勘者${index + 1}`, color };
}

/** 合并用户信息（局部覆盖） */
export function resolveUser(patch?: Partial<CollabUser>): CollabUser {
  const base = createDefaultUser();
  return { ...base, ...patch };
}
