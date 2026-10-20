/**
 * 古籍仿真直排版式模板
 *
 * 六个常见木刻 / 抄本版式，供设置面板一键套用。数据是**纯数据**：
 * - `layout`：布局选项（含 `facsimile`），套用时整体作为布局补丁写入；
 * - `tokens`：相对默认主题的令牌覆盖（纸色 / 墨色 / 边距 / 字号行距 / 字体族）。
 *
 * 令牌**不写入用户的令牌补丁**，而是由调用方按模板 id 派生合并——这样从
 * 「古籍仿真直排」切回「古籍直排」时不会残留仿真纸色与框色（见清单 §3.6）。
 *
 * 行款（每半页行数 × 每行字数）由 `resolveFacsimileGrid` 按参数推导，
 * 并由测试锁定；改模板数值必须同步改文档表格与测试断言。
 */
import {
  COLOR_TOKENS,
  FONT_SIZE_TOKENS,
  FONT_TOKENS,
  LAYOUT_TOKENS,
} from '@bibliotype/core';
import {
  DEFAULT_GUTTER_FIELDS,
  FACSIMILE_FONT_TOKENS,
  FACSIMILE_FRAMES,
  FACSIMILE_RULES,
  GUTTER_FISH_TAILS,
  GUTTER_MOUTHS,
  GUTTER_SIDES,
  type FacsimileOptions,
  type GutterFishTail,
  type GutterMouth,
} from './facsimile.js';
import type { PageChromeField } from './layout-options.js';
import {
  FACSIMILE_BASE_LAYOUT,
  mergeLayoutOptions,
  type LayoutOptions,
} from './layout-options.js';
import { PAGE_SIZES, type PageSize } from './page-size.js';

/** 宋体族（浙本 / 汲古阁 / 巾箱本） */
const SONG_STACK = "'Songti SC', 'STSong', 'SimSun', 'Noto Serif CJK SC', serif";
/** 仿宋族（嘉靖本） */
const FANGSONG_STACK = "'FangSong', 'STFangsong', 'FangSong_GB2312', 'Noto Serif CJK SC', serif";

/** 古籍仿真版式模板 */
export interface FacsimilePreset {
  /** 模板 id（写入 `layout.facsimile.preset`，用于面板回显与重置） */
  id: string;
  /** 面板主标签 */
  label: string;
  /** 面板副标题（版式特征摘要） */
  description: string;
  /** 布局选项（含 `facsimile`） */
  layout: LayoutOptions;
  /** 令牌覆盖（纸色 / 墨色 / 边距 / 字号行距 / 字体族） */
  tokens: Readonly<Record<string, string>>;
  /** 正文字体令牌键（配合 `tokens` 使用） */
  fontToken: string;
}

/** 模板种子（把重复的换算收敛到一处，避免六个模板复制粘贴） */
interface PresetSeed {
  id: string;
  label: string;
  description: string;
  pageSize: PageSize;
  /** 正文字号（px） */
  fontSize: number;
  /** 行距（倍数） */
  lineHeight: number;
  /** 字距（em 值字符串） */
  letterSpacing: string;
  /** 页边距（上 右 下 左，px） */
  margin: string;
  frame: FacsimileOptions['frame'];
  rule: FacsimileOptions['rule'];
  /** 版心带宽（px） */
  gutterSize: number;
  mouth: GutterMouth;
  fishTail: GutterFishTail;
  /** 版心字段序列（缺省 `DEFAULT_GUTTER_FIELDS`） */
  fields?: readonly PageChromeField[];
  /** 纸色 */
  background: string;
  /** 正文墨色 */
  text: string;
  /** 注文墨色 */
  note: string;
  /** 版框 / 界行颜色 */
  frameColor: string;
  /** 界行颜色（朱丝栏与框色同为朱） */
  ruleColor: string;
  /** 正文字体令牌键 */
  fontToken: string;
  /** 需要写入的字体族令牌键（楷体复用 core 既有令牌，无需写入） */
  fontFamilyToken?: string;
  /** 字体族值 */
  fontStack?: string;
}

/** 由种子构建模板（纯函数，输出不可变数据） */
function createPreset(seed: PresetSeed): FacsimilePreset {
  const facsimile: FacsimileOptions = {
    preset: seed.id,
    frame: seed.frame,
    rule: seed.rule,
    gutter: {
      side: GUTTER_SIDES.LEFT,
      size: seed.gutterSize,
      mouth: seed.mouth,
      fishTail: seed.fishTail,
      fields: seed.fields ?? DEFAULT_GUTTER_FIELDS,
    },
  };

  const tokens: Record<string, string> = {
    [LAYOUT_TOKENS.PAGE_MARGIN]: seed.margin,
    [FONT_SIZE_TOKENS.BODY]: `${seed.fontSize}px`,
    [LAYOUT_TOKENS.LINE_HEIGHT]: String(seed.lineHeight),
    [LAYOUT_TOKENS.LETTER_SPACING]: seed.letterSpacing,
    /* 古籍正文无首行缩进（缩进靠版式体现） */
    [LAYOUT_TOKENS.TEXT_INDENT]: '0',
    [COLOR_TOKENS.BACKGROUND]: seed.background,
    [COLOR_TOKENS.TEXT]: seed.text,
    [COLOR_TOKENS.NOTE_TEXT]: seed.note,
    'page-frame-color': seed.frameColor,
    'page-rule-color': seed.ruleColor,
    'gutter-color': seed.frameColor,
  };
  if (seed.fontFamilyToken !== undefined && seed.fontStack !== undefined) {
    tokens[seed.fontFamilyToken] = seed.fontStack;
  }

  return {
    id: seed.id,
    label: seed.label,
    description: seed.description,
    layout: {
      ...FACSIMILE_BASE_LAYOUT,
      pageSize: seed.pageSize,
      facsimile,
    },
    tokens,
    fontToken: seed.fontToken,
  };
}

/**
 * 六个古籍版式模板（顺序即面板顺序，`[0]` 为默认模板）
 *
 * 行款（由参数推导，测试锁定）：
 * 1. 宋刻浙本 10 行 × 27 字；2. 明嘉靖本 12 行 × 29 字；3. 清武英殿本 11 行 × 29 字；
 * 4. 汲古阁本 14 行 × 32 字；5. 朱丝栏抄本 10 行 × 29 字；6. 巾箱本 12 行 × 34 字。
 */
export const FACSIMILE_PRESETS: readonly FacsimilePreset[] = [
  createPreset({
    id: 'song-zhe',
    label: '宋刻浙本',
    description: '白口单鱼尾 · 四周双边 · 半页十行',
    pageSize: PAGE_SIZES.FOLIO_16,
    fontSize: 22,
    lineHeight: 1.95,
    letterSpacing: '0.02em',
    margin: '200px 120px 173px 90px',
    frame: FACSIMILE_FRAMES.DOUBLE,
    rule: FACSIMILE_RULES.INK,
    gutterSize: 34,
    mouth: GUTTER_MOUTHS.WHITE,
    fishTail: GUTTER_FISH_TAILS.SINGLE,
    fields: ['bookTitle', 'volumeTitle', 'pageNumber'],
    background: '#f2e8d5',
    text: '#2b241c',
    note: '#5c5142',
    frameColor: '#3b322a',
    ruleColor: '#3b322a',
    fontToken: FACSIMILE_FONT_TOKENS.SONG,
    fontFamilyToken: FACSIMILE_FONT_TOKENS.SONG,
    fontStack: SONG_STACK,
  }),
  createPreset({
    id: 'ming-jiajing',
    label: '明嘉靖本',
    description: '白口单鱼尾 · 四周单边 · 仿宋字',
    pageSize: PAGE_SIZES.FOLIO_16,
    fontSize: 21,
    lineHeight: 1.75,
    letterSpacing: '0.02em',
    margin: '186px 116px 168px 86px',
    frame: FACSIMILE_FRAMES.SINGLE,
    rule: FACSIMILE_RULES.INK,
    gutterSize: 30,
    mouth: GUTTER_MOUTHS.WHITE,
    fishTail: GUTTER_FISH_TAILS.SINGLE,
    fields: ['bookTitle', 'chapterTitle', 'pageNumber'],
    background: '#f5eddc',
    text: '#2b241c',
    note: '#5a4f40',
    frameColor: '#3b322a',
    ruleColor: '#3b322a',
    fontToken: FACSIMILE_FONT_TOKENS.FANGSONG,
    fontFamilyToken: FACSIMILE_FONT_TOKENS.FANGSONG,
    fontStack: FANGSONG_STACK,
  }),
  createPreset({
    id: 'qing-dianben',
    label: '清武英殿本',
    description: '馆阁楷体 · 四周双边 · 大 16 开',
    pageSize: PAGE_SIZES.DACHU_16,
    fontSize: 25,
    lineHeight: 1.85,
    letterSpacing: '0.03em',
    margin: '170px 120px 140px 82px',
    frame: FACSIMILE_FRAMES.DOUBLE,
    rule: FACSIMILE_RULES.INK,
    gutterSize: 38,
    mouth: GUTTER_MOUTHS.WHITE,
    fishTail: GUTTER_FISH_TAILS.SINGLE,
    fields: ['bookTitle', 'volumeTitle', 'chapterTitle', 'pageNumber'],
    background: '#f7f1e3',
    text: '#241f19',
    note: '#574d3f',
    frameColor: '#3b322a',
    ruleColor: '#3b322a',
    fontToken: FONT_TOKENS.CLASSICAL_BODY,
  }),
  createPreset({
    id: 'jiguge',
    label: '汲古阁本',
    description: '细黑口 · 左右双边 · 行密字小',
    pageSize: PAGE_SIZES.FOLIO_16,
    fontSize: 20,
    lineHeight: 1.7,
    letterSpacing: '0.02em',
    margin: '172px 100px 150px 72px',
    frame: FACSIMILE_FRAMES.LEFT_RIGHT,
    rule: FACSIMILE_RULES.INK,
    gutterSize: 28,
    mouth: GUTTER_MOUTHS.BLACK,
    fishTail: GUTTER_FISH_TAILS.SINGLE,
    fields: ['bookTitle', 'chapterTitle', 'pageNumber'],
    background: '#f4ead6',
    text: '#2b241c',
    note: '#5c5142',
    frameColor: '#332c24',
    ruleColor: '#332c24',
    fontToken: FACSIMILE_FONT_TOKENS.SONG,
    fontFamilyToken: FACSIMILE_FONT_TOKENS.SONG,
    fontStack: SONG_STACK,
  }),
  createPreset({
    id: 'zhushilan',
    label: '朱丝栏抄本',
    description: '朱框朱栏 · 楷书精抄 · 无鱼尾',
    pageSize: PAGE_SIZES.FOLIO_16,
    fontSize: 23,
    lineHeight: 2,
    letterSpacing: '0.04em',
    margin: '150px 110px 120px 74px',
    frame: FACSIMILE_FRAMES.DOUBLE,
    rule: FACSIMILE_RULES.VERMILION,
    gutterSize: 36,
    mouth: GUTTER_MOUTHS.WHITE,
    fishTail: GUTTER_FISH_TAILS.NONE,
    fields: ['volumeTitle', 'pageNumber'],
    background: '#f9f2e4',
    text: '#33261f',
    note: '#6b3a30',
    frameColor: '#a33a2a',
    ruleColor: '#a33a2a',
    fontToken: FONT_TOKENS.CLASSICAL_BODY,
  }),
  createPreset({
    id: 'jinxiang',
    label: '巾箱本',
    description: '巾箱小本 · 四周单边 · 行少字微',
    pageSize: PAGE_SIZES.FOLIO_32,
    fontSize: 15,
    lineHeight: 1.85,
    letterSpacing: '0.01em',
    margin: '96px 66px 74px 42px',
    frame: FACSIMILE_FRAMES.SINGLE,
    rule: FACSIMILE_RULES.INK,
    gutterSize: 24,
    mouth: GUTTER_MOUTHS.BLACK,
    fishTail: GUTTER_FISH_TAILS.SINGLE,
    fields: ['chapterTitle', 'pageNumber'],
    background: '#f5eedd',
    text: '#2b241c',
    note: '#5c5142',
    frameColor: '#3b322a',
    ruleColor: '#3b322a',
    fontToken: FACSIMILE_FONT_TOKENS.SONG,
    fontFamilyToken: FACSIMILE_FONT_TOKENS.SONG,
    fontStack: SONG_STACK,
  }),
];

/** 默认模板（进入「古籍仿真直排」主题时套用的第一个） */
export const DEFAULT_FACSIMILE_PRESET_ID = FACSIMILE_PRESETS[0]?.id ?? 'song-zhe';

/** 按 id 取模板（未知 id → undefined，调用方回落默认值） */
export function resolveFacsimilePreset(id: string | undefined): FacsimilePreset | undefined {
  if (id === undefined) return undefined;
  return FACSIMILE_PRESETS.find((preset) => preset.id === id);
}

/**
 * 套用模板到当前布局（纯函数）
 *
 * 返回新布局（模板的布局字段整体覆盖基准）；令牌与字体由调用方从
 * `preset.tokens` / `preset.fontToken` 派生合并，不写入用户补丁。
 */
export function applyFacsimilePreset(
  base: LayoutOptions,
  preset: FacsimilePreset,
): LayoutOptions {
  return mergeLayoutOptions(base, preset.layout);
}
