/**
 * docx → HTML（副作用层：调用 mammoth 解析二进制）
 *
 * 依赖方向：import-docx → mammoth（外部重依赖，隔离在本叶子包，§一矩阵 / §七风险）。
 * 本模块把 `.docx` 归一为标准 HTML 字符串，交由 `@bibliotype/import` 的 HTML 通路回收为 IR；
 * mammoth 含 Node / 浏览器双实现且体积较大，务必只出现在本包，`editor` / `import` 不得反向引用。
 */
import mammoth from 'mammoth';

/** mammoth `convertToHtml` 的入参类型（其 `.d.ts` 以 `export =` 导出、未导出命名类型，借索引访问获取） */
type MammothInput = Parameters<typeof mammoth.convertToHtml>[0];
/** mammoth `convertToHtml` 的选项类型 */
type MammothOptions = NonNullable<Parameters<typeof mammoth.convertToHtml>[1]>;
/** mammoth 图片转换器类型（用于 D4 资源策略，避免直接引入命名类型） */
export type DocxImageConverter = NonNullable<MammothOptions['convertImage']>;

/** docx 原始字节：浏览器 `File.arrayBuffer()`、Node `fs.readFile`·`Buffer` 统一入口 */
export type DocxInput = ArrayBuffer | Uint8Array;

/** docx → HTML 可选项（图片 / 资源解析钩子按 D4 预留） */
export interface DocxToHtmlOptions {
  /**
   * 追加的 mammoth `styleMap` 规则（如把自定义段落样式映射为标题）；
   * 缺省沿用 mammoth 默认样式映射（`Heading 1` → `<h1>` 等）。
   */
  styleMap?: string | string[];
  /**
   * 内嵌图片转换策略（D4）：
   * - 缺省 **base64 data URI 内联**（F5）：保证导入后图片可直接渲染；
   * - 传自定义 `mammoth.images.imgElement(fn)` 实现资源解析钩子（图床 / 附件），
   *   返回空 `src` 即退化为占位（D4-a）。
   */
  convertImage?: DocxImageConverter;
}

/** Word 脚注引用：`<sup><a href="#footnote-1">1</a></sup>` */
const FOOTNOTE_REF_RE = /<sup>\s*<a href="#footnote-(\d+)"[^>]*>([\s\S]*?)<\/a>\s*<\/sup>/g;

/** 脚注回跳链接（注文末尾的 `↑`）：归一后由 noteref 负责回跳，直接去掉 */
const FOOTNOTE_BACKLINK_RE = /<a href="#footnote-ref-\d+"[^>]*>[\s\S]*?<\/a>/g;

/** 文末脚注列表项：`<li id="footnote-1">…</li>` */
const FOOTNOTE_ITEM_RE = /<li id="footnote-(\d+)">([\s\S]*?)<\/li>/g;

/**
 * 把 mammoth 的脚注 HTML 归一为库内约定结构
 *
 * - 正文引用 → `<a class="bt-mark-noteref" href="#fn-docx-N" id="ref-docx-N">N</a>`，
 *   由 PM 的 `noteref` mark 规则识别；
 * - 文末列表项 → `<div class="bt-footnote" data-id="fn-docx-N" data-marker="N" …>`，
 *   由 `footnote` 节点的 parseDOM 规则识别；
 * - 清空被搬空的 `<ol>` 与注文里的回跳箭头。
 *
 * 只依赖 mammoth 稳定的 HTML 输出，不触碰其内部 AST。
 */
export function normalizeDocxFootnotes(html: string): string {
  let output = html.replace(FOOTNOTE_BACKLINK_RE, '');
  output = output.replace(
    FOOTNOTE_REF_RE,
    (_match, index: string, inner: string) =>
      `<a class="bt-mark-noteref" href="#fn-docx-${index}" id="ref-docx-${index}">${inner}</a>`,
  );
  output = output.replace(
    FOOTNOTE_ITEM_RE,
    (_match, index: string, inner: string) =>
      `<div class="bt-footnote" data-id="fn-docx-${index}" data-marker="${index}" data-ref-id="ref-docx-${index}">${inner}</div>`,
  );
  /* 拆掉只包裹脚注 div 的 <ol> 外壳（div 不能合法嵌在 ol 里） */
  return output.replace(/<ol>\s*(<div class="bt-footnote"[\s\S]*?)<\/ol>\s*/g, '$1');
}

/** 归一为字节视图，兼容 `ArrayBuffer` 与带自定义 offset / 长度的 `Uint8Array` */
function toView(data: DocxInput): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/**
 * 构造双端通用的 mammoth 输入对象
 *
 * mammoth 依运行环境读取不同字段：Node 版 `unzip` 只认 `buffer` / `path` / `file`，
 * 浏览器版只认 `arrayBuffer`；两者底层同为 JSZip，对 `Uint8Array` / `ArrayBuffer` 均可接收。
 * 故**同时**提供 `arrayBuffer` 与 `buffer` 两个字段——Node 走 `buffer`、浏览器走 `arrayBuffer`，
 * 互不干扰，免去运行期环境探测。
 */
function buildInput(view: Uint8Array): MammothInput {
  const arrayBuffer = view.slice(view.byteOffset, view.byteOffset + view.byteLength).buffer;
  return { arrayBuffer, buffer: view } as unknown as MammothInput;
}

/**
 * 将 `.docx` 字节转换为标准 HTML 字符串
 *
 * @param input docx 原始字节（浏览器 `ArrayBuffer` / Node `Uint8Array`·`Buffer`）
 * @param options 可选样式映射与图片策略
 * @returns mammoth 产出的 HTML 片段（标题 / 段落 / 列表 / 强调等标准标签）
 * @throws 空数据或非合法 / 损坏 `.docx` 时，抛出带修复指向的中文 `RangeError`
 */
export async function docxToHtml(input: DocxInput, options: DocxToHtmlOptions = {}): Promise<string> {
  const view = toView(input);
  if (view.byteLength === 0) {
    throw new RangeError('docx 数据为空：请传入有效的 .docx 文件字节（ArrayBuffer 或 Uint8Array）。');
  }

  const mammothOptions: MammothOptions = {
    // F5：缺省内联 base64（data URI）；调用方可用 convertImage 覆盖为资源钩子
    convertImage: options.convertImage ?? mammoth.images.dataUri,
    ...(options.styleMap !== undefined ? { styleMap: options.styleMap } : {}),
  };

  let html: string;
  try {
    const result = await mammoth.convertToHtml(buildInput(view), mammothOptions);
    html = result.value;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new RangeError(`docx 解析失败（非合法 .docx 或文件已损坏）：${detail}`);
  }

  // 解析成功但内容为空：多为非 OOXML 的 zip 或被 mammoth 判定无正文，给出明确指向而非静默产出空文档
  if (html.trim() === '') {
    throw new RangeError('docx 解析结果为空：文件可能不含正文，或并非 Word 的 .docx（OOXML）格式。');
  }
  return normalizeDocxFootnotes(html);
}
