/**
 * 版心（书口）文本解析
 *
 * 与 `layout.facsimile.gutter` 配套：布局侧只负责占位与几何（版心带宽从主轴
 * 扣除），本模块负责「内容」——把书名 / 篇卷 / 叶次整理成版心竖写文本，
 * 供阅读视图、编辑分页画布与打印稿三端按页注入。
 *
 * 与页眉页脚的分工：本函数只做字段取值与去空白，字段筛选（`fields` 顺序）
 * 由序列化侧按布局配置决定，避免两侧各存一份字段规则。
 */
import type { PageGutterTexts } from '@bibliotype/layout';

/** 版心文本解析输入 */
export interface ResolvePageGutterInput {
  /** 书名 */
  bookTitle: string;
  /** 该页篇卷 / 章名（缺省空串） */
  chapterTitle: string;
  /** 已格式化的叶次（含中文 / 罗马数字样式） */
  pageNumberText: string;
}

/**
 * 解析版心竖写文本
 *
 * 三段文本均去首尾空白；某个字段为空时由序列化侧跳过，不产生空行。
 */
export function resolvePageGutterTexts(input: ResolvePageGutterInput): PageGutterTexts {
  return {
    bookTitle: input.bookTitle.trim(),
    chapterTitle: input.chapterTitle.trim(),
    pageNumber: input.pageNumberText.trim(),
  };
}
