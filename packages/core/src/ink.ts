/**
 * 批点套印墨色（v2 批 6）
 *
 * 朱墨套印：正文用墨、批注与圈点用朱（可扩蓝 / 黄——多评家分色，归有光
 * 五色圈点义例的现代化简）。色层落在注 / 批节点与圈点标记的 `inkColor`
 * 属性上，渲染经 `data-ink-*` 属性选择器取 `--bt-ink-*` 变量；单色模式
 * （`buildBookCss` 的 `monoInk`）跳过色层规则即回归全墨。
 */

/** 套印墨色 */
export const INK_COLORS = {
  /** 墨（正文色，缺省） */
  BLACK: 'black',
  /** 朱（批注 / 圈点常例） */
  RED: 'red',
  /** 蓝 */
  BLUE: 'blue',
  /** 黄 */
  YELLOW: 'yellow',
} as const;

/** 套印墨色联合类型 */
export type InkColor = (typeof INK_COLORS)[keyof typeof INK_COLORS];

/** 各墨色的 CSS 变量名（值由主题 / 宿主定义，缺省色见 book-css 的兜底） */
export function inkColorVarOf(color: InkColor): string {
  return `--bt-ink-${color}`;
}
