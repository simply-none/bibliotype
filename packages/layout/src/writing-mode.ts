/**
 * 书写方向定义
 *
 * 对应调研清单 § 四「书写方向」：
 * - 横排左起（现代书籍默认）
 * - 竖排右起（古籍默认，vertical-rl）
 * - 竖排左起（少数场景，如某些碑刻排布）
 */
export const WRITING_MODES = {
  /** 横排，自上而下、自左而右 */
  HORIZONTAL_TB: 'horizontal-tb',
  /** 竖排，自右而左（古籍标准） */
  VERTICAL_RL: 'vertical-rl',
  /** 竖排，自左而右 */
  VERTICAL_LR: 'vertical-lr',
} as const;

/** 书写方向联合类型 */
export type WritingMode = (typeof WRITING_MODES)[keyof typeof WRITING_MODES];

/** 直排中字符方向（CSS text-orientation） */
export const TEXT_ORIENTATIONS = {
  /** 跟随文字方向（CJK 直立，拉丁侧转） */
  MIXED: 'mixed',
  /** 全部直立 */
  UPRIGHT: 'upright',
  /** 全部侧转 */
  SIDEWAYS: 'sideways',
} as const;

/** 字符方向联合类型 */
export type TextOrientation =
  (typeof TEXT_ORIENTATIONS)[keyof typeof TEXT_ORIENTATIONS];

/** 判断是否为竖排 */
export function isVerticalMode(mode: WritingMode): boolean {
  return mode === WRITING_MODES.VERTICAL_RL || mode === WRITING_MODES.VERTICAL_LR;
}
