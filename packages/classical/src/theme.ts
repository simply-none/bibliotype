/**
 * 古籍主题令牌与覆盖
 *
 * classical 在安装时向主题访问器写入古籍风格令牌：
 * - 覆盖 core 令牌：古籍正文字体（楷体系优先）、版式（无首行缩进、竖排相关）
 * - 新增令牌：书写方向、数字/英文直排策略（D3 补充落地）
 *
 * 新增令牌键可被 layout 包消费以生成 CSS。
 */

/** 古籍专有令牌（core ThemeToken 之外的扩展键） */
export const CLASSICAL_THEME_TOKENS = {
  /** 书写方向：horizontal-tb（横排）/ vertical-rl（直排右起） */
  WRITING_MODE: 'writing-mode',
  /** 直排中字符方向：mixed（默认）/ upright / sideways */
  TEXT_ORIENTATION: 'text-orientation',
  /** 数字合并策略：all / digits（配合 n 值使用） */
  TEXT_COMBINE_UPRIGHT: 'text-combine-upright',
  /** 数字合并位数上限（如 4 位以内按一格合并） */
  TEXT_COMBINE_LIMIT: 'text-combine-limit',
} as const;

/** 古籍主题令牌键联合 */
export type ClassicalThemeToken =
  (typeof CLASSICAL_THEME_TOKENS)[keyof typeof CLASSICAL_THEME_TOKENS];

/** 古籍主题默认值（安装时写入，卸载时还原） */
export const CLASSICAL_THEME_OVERRIDES: Readonly<Record<string, string>> = {
  /* 覆盖 core：古籍正文以楷体为基调 */
  'font-family-classical-body':
    "'Kaiti SC', 'KaiTi', 'STKaiti', 'Noto Serif CJK SC', serif",

  /* 覆盖 core：古籍无首行缩进（缩进靠批注/行款体现） */
  'text-indent-body': '0',

  /* 新增：书写方向与直排策略（默认直排右起，符合古籍习惯） */
  [CLASSICAL_THEME_TOKENS.WRITING_MODE]: 'vertical-rl',
  [CLASSICAL_THEME_TOKENS.TEXT_ORIENTATION]: 'mixed',
  [CLASSICAL_THEME_TOKENS.TEXT_COMBINE_UPRIGHT]: 'digits',
  [CLASSICAL_THEME_TOKENS.TEXT_COMBINE_LIMIT]: '4',
};
