/**
 * DOCX 导出的公开类型与问题码
 *
 * 设计取向（与 EPUB 导出器一致）：
 * - 导出器是「适配层」，只消费 IR、不反向依赖编辑 / 渲染；
 * - 无法在 Word 里等价表达的语义**不静默丢弃**，统一经问题码回传宿主；
 * - 产物与问题分离：`exportDocx` 只给字节，`buildDocxDocument` 额外给问题清单，
 *   便于宿主在导出后提示「有几张外链图未嵌入」这类信息。
 */
import type { ConditionContext, NamedStyleSet } from '@bibliotype/core';
import type { Document } from 'docx';

/** 导出问题码 */
export type DocxProblemCode =
  /** 图片为外链（http/https/blob），未嵌入 docx */
  | 'external-src'
  /** 图片为相对路径 / 本地路径，无法随文件携带 */
  | 'relative-src'
  /** data URI 非法、格式不受 Word 支持（SVG / WebP 等） */
  | 'unsupported-image'
  /** 图片字节超过上限（防止把超大 base64 打进文档） */
  | 'oversize-src'
  /** 未知节点类型按段落降级 */
  | 'unsupported-node'
  /** 注音（ruby）降级为「汉字（注音）」 */
  | 'ruby-degraded'
  /** 公式降级为 TeX 源码文本 */
  | 'math-degraded'
  /** 注引用（noteref）找不到目标注释块 */
  | 'note-orphan'
  /** 注释块未被任何注引用指向，按普通段落输出 */
  | 'note-unreferenced';

/** 单条导出问题 */
export interface DocxProblem {
  /** 问题码 */
  code: DocxProblemCode;
  /** 中文说明（可直接展示给用户） */
  message: string;
  /** 相关节点 id（有则带上，便于定位） */
  nodeId?: string;
}

/** 页面尺寸（毫米） */
export interface PageSizeMm {
  width: number;
  height: number;
}

/** 页边距（毫米） */
export interface PageMarginsMm {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * 修订视图
 *
 * - `final`（缺省）：终稿，删除内容不输出；
 * - `original`：原稿，插入内容不输出；
 * - `marked`：近似标记视图——插入加下划线、删除加删除线。
 *
 * `marked` 不是 Word 原生修订（`w:ins` / `w:del`），只是视觉近似，
 * 需要真正可接受 / 拒绝的修订留待后续接入 `InsertedTextRun` / `DeletedTextRun`。
 */
export type DocxRevisionView = 'final' | 'original' | 'marked';

/** 导出选项 */
export interface DocxExportOptions {
  /** 页面尺寸（毫米），缺省 A4 210×297 */
  pageSize?: PageSizeMm;
  /** 页边距（毫米），缺省四边 25 */
  margins?: PageMarginsMm;
  /** 命名样式集合（IR `attrs.styleId` → Word 段落样式） */
  namedStyles?: NamedStyleSet;
  /** 正文字体，缺省「宋体」 */
  bodyFontFamily?: string;
  /** 正文字号（磅），缺省 12（小四） */
  bodyFontSizePt?: number;
  /** 标题字体，缺省「黑体」 */
  headingFontFamily?: string;
  /** 首行缩进字符数，缺省 2；0 表示不缩进 */
  firstLineIndentChars?: number;
  /** 图片最大宽度（毫米），缺省取版心宽度 */
  imageMaxWidthMm?: number;
  /** 单张图片字节上限，缺省 8 MiB */
  maxImageBytes?: number;
  /** 条件内容上下文（`condition.when` 求值用；缺省保留全部条件内容） */
  conditionContext?: ConditionContext;
  /** 修订视图，缺省 `final` */
  revisionView?: DocxRevisionView;
  /** 问题回调（每条问题触发一次；与返回的问题清单同源） */
  onProblem?: (problem: DocxProblem) => void;
}

/** 归一化后的导出选项（内部使用，所有字段必有值） */
export interface ResolvedDocxOptions {
  pageSize: PageSizeMm;
  margins: PageMarginsMm;
  namedStyles?: NamedStyleSet;
  bodyFontFamily: string;
  bodyFontSizePt: number;
  headingFontFamily: string;
  firstLineIndentChars: number;
  imageMaxWidthMm: number;
  maxImageBytes: number;
  conditionContext?: ConditionContext;
  revisionView: DocxRevisionView;
  onProblem?: (problem: DocxProblem) => void;
}

/** `buildDocxDocument` 的返回值 */
export interface BuiltDocxDocument {
  /** docx 文档对象（宿主可继续定制 sections / styles） */
  document: Document;
  /** 导出过程中记录的问题 */
  problems: DocxProblem[];
}
