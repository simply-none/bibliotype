/**
 * 字体内嵌与子集化：类型定义（E3）
 *
 * 依赖方向：本包只依赖 `@bibliotype/core`（IR / 错误码 / 哈希），
 * 供 `exporter-epub`、`exporter-site` 等适配层复用；不内置字体解析二进制。
 */

/** 字体文件格式（源格式与目标格式共用） */
export type FontFormat = 'woff2' | 'woff' | 'ttf' | 'otf';

/** 字体许可信息（写入许可声明与 OPF dc:rights） */
export interface FontLicense {
  /** 许可名（如 `SIL Open Font License 1.1`） */
  name: string;
  /** 许可地址（可选） */
  url?: string;
  /** 版权行（可选） */
  copyright?: string;
}

/** 待嵌入的字体资产（字节由宿主从资产端口读出后传入） */
export interface FontAssetInput {
  /** 资产标识（会话内唯一，用于报告与许可去重） */
  id: string;
  /** CSS `font-family` 名（如 `Classical Kai`） */
  family: string;
  /** 字体源字节（ttf / otf / woff / woff2） */
  bytes: Uint8Array;
  /** 源格式（缺省按魔术字节嗅探，再缺省 `ttf`） */
  format?: FontFormat;
  /** 字重（缺省 400；可变字体可传 100 200 之类区间串） */
  weight?: number | string;
  /** 字形风格（缺省 `normal`） */
  style?: 'normal' | 'italic' | 'oblique';
  /** 许可信息（缺省视为未声明，导出时告警） */
  license?: FontLicense;
}

/** 子集化请求（后端按此产出子集字节） */
export interface FontSubsetRequest {
  /** 源字节 */
  bytes: Uint8Array;
  /** 源格式 */
  format: FontFormat;
  /** 需要保留的字符（去重升序，含空格与标点） */
  chars: string;
  /** 目标格式（缺省 `woff2`） */
  targetFormat: FontFormat;
  /** 字体族名 */
  family: string;
  /** 字重 */
  weight: number | string;
  /** 字形风格 */
  style: 'normal' | 'italic' | 'oblique';
}

/** 子集化结果 */
export interface FontSubsetResult {
  /** 子集字节 */
  bytes: Uint8Array;
  /** 实际输出格式（后端只支持 ttf 时可回改，缺省按请求） */
  format?: FontFormat;
  /**
   * 子集后仍缺的字符（可选）
   *
   * 后端若能提供覆盖信息（如 fonttools 的 cmap 检查），应把缺字写在这里；
   * 未提供时报告标记「覆盖信息不完整」，不做假阴性判断。
   */
  missingChars?: string;
}

/**
 * 子集化后端端口（宿主适配，不内置二进制）
 *
 * 典型实现：
 * - `subset-font`（harfbuzz wasm，浏览器 / Node 同构）；
 * - `fonttools`（`pyftsubset`，Node 侧调子进程）。
 */
export interface FontSubsetBackend {
  /** 后端名称（报告用） */
  readonly name: string;
  /** 子集化一个字体 */
  subset(request: FontSubsetRequest): Promise<FontSubsetResult>;
}

/** 用字统计结果 */
export interface CharUsage {
  /** 去重升序的字符集（可直接交给子集后端） */
  chars: string;
  /** 字符 → 出现次数 */
  counts: ReadonlyMap<string, number>;
  /** 全书字符总数（含重复） */
  total: number;
  /** 去重字数 */
  unique: number;
}

/** 单字体族的覆盖报告 */
export interface FontFamilyReport {
  /** 资产 id */
  id: string;
  /** 字体族名 */
  family: string;
  /** 源字节数 */
  sourceBytes: number;
  /** 子集后字节数 */
  subsetBytes: number;
  /** 子集后仍缺的字符（后端未提供覆盖信息时为空串） */
  missingChars: string;
  /** 缺字回退链（主题字体栈中该族之后的族名） */
  fallbackChain: string[];
  /** 是否做了子集化 */
  subsetted: boolean;
}

/** 字体覆盖报告（导出前报告用） */
export interface FontCoverageReport {
  /** 全书去重字符集 */
  chars: string;
  /** 全书字符总数 */
  total: number;
  /** 去重字数 */
  unique: number;
  /** 各字体族报告 */
  families: FontFamilyReport[];
  /** 源字节合计 */
  sourceBytes: number;
  /** 子集后字节合计 */
  subsetBytes: number;
  /** 体积下降比例（0~1；未子集为 0） */
  reduction: number;
  /** 是否有字体报告缺字 */
  hasMissing: boolean;
}

/** 子集化后的字体面（@font-face 一项） */
export interface PreparedFontFace {
  /** 源资产 id */
  id: string;
  /** 字体族名 */
  family: string;
  /** 字重 */
  weight: number | string;
  /** 字形风格 */
  style: 'normal' | 'italic' | 'oblique';
  /** 输出格式 */
  format: FontFormat;
  /** MIME 类型（manifest / 站点文件用） */
  mediaType: string;
  /** 字体目录内文件名（不含目录） */
  fileName: string;
  /** 相对 CSS 的路径（如 `fonts/bt-kai-400-1a2b3c4d.woff2`） */
  href: string;
  /** 子集字节 */
  bytes: Uint8Array;
  /** 许可信息 */
  license?: FontLicense;
}

/** 字体包（导出器直接消费：CSS + 文件 + 许可 + 报告） */
export interface FontBundle {
  /** 字体面（@font-face 与文件同序） */
  faces: PreparedFontFace[];
  /** `@font-face` 声明（相对路径已按 `fontDirectory` 展开） */
  css: string;
  /** 许可文件路径（相对包根 / 站点根，如 `fonts/LICENSE.txt`；无许可时为 undefined） */
  licensePath?: string;
  /** 许可声明全文（无任何许可信息时为 undefined） */
  license?: string;
  /** 简短版权行（OPF `dc:rights` 用） */
  rights?: string;
  /** 覆盖报告（导出前缺字报告 / 体积对比） */
  report: FontCoverageReport;
  /** 非致命告警（缺后端 / 缺字 / 缺许可） */
  warnings: string[];
}

/** 准备字体包的选项 */
export interface PrepareFontBundleOptions {
  /** 子集化后端（缺省不子集，原样嵌入并告警） */
  backend?: FontSubsetBackend;
  /** 目标格式（缺省 `woff2`；后端可回改） */
  targetFormat?: FontFormat;
  /** 字体栈（主题令牌值，用于缺字回退链报告） */
  fallbackStack?: string;
  /** 附加字符（UI 文案 / 固定标点等，与全书用字合并） */
  extraChars?: string;
  /** 字体文件目录（CSS url 前缀，缺省 `fonts/`） */
  fontDirectory?: string;
  /** 字体展示策略（缺省 `swap`） */
  fontDisplay?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
  /** 文件名前缀（缺省 `bt-`） */
  fileNamePrefix?: string;
  /** 文件名族名段最大长度（缺省 24） */
  slugLength?: number;
}
