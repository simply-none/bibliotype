/**
 * IR 基础类型定义
 *
 * 这些类型是 bibliotype IR（中间表示）的基石，
 * 被节点、标记、元数据、文档等模块共同引用。
 */

/** 全局唯一节点标识（协同锚点、批注引用依赖其稳定性） */
export type NodeId = string;

/** ISO 8601 时间戳，如 "2026-10-12T08:00:00.000Z" */
export type Timestamp = string;

/**
 * 语义标签属性值
 *
 * 允许字符串、数字或布尔（对应 D3 补充：属性值允许英文与数字，
 * 如 `<folio page="123" recto="true">`）。
 */
export type AttrValue = string | number | boolean;

/** 节点/标记的属性集合 */
export type Attrs = Record<string, AttrValue>;

/** 零基索引、半开区间的文本位置描述 */
export interface TextRange {
  /** 起始偏移（含） */
  from: number;
  /** 结束偏移（不含） */
  to: number;
}
