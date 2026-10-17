/**
 * 导出前校验器（epubcheck 规则子集，外部阅读器视角）
 *
 * 动机：容器 / OPF / 目录 / 媒体引用的问题在自研阅读器里被容错解析掩盖，
 * 到京东读书（RMSDK）/ 微信读书才爆发为「整本书打不开」。主流工具
 * （InDesign 建议 epubcheck、Sigil 内置 Validate、Calibre 输出保证过校验）
 * 都有发布前校验一环，本模块把该守门员内置到导出链路。
 *
 * 校验对象为「打包前的条目表」（插入序即 zip 序），不依赖 zip 字节；
 * zip 层（mimetype STORE / extra）由既有单测覆盖。
 */

/** 问题严重级别 */
export type ProblemSeverity = 'error' | 'warning';

/** 单个校验问题 */
export interface ValidationProblem {
  severity: ProblemSeverity;
  /** 机器可读码（如 'PKG-04'） */
  code: string;
  /** 人类可读说明（中文） */
  message: string;
  /** 相关条目路径（可缺省） */
  path?: string;
}

/** 校验输入 */
export interface ValidateEpubInput {
  /** 条目表（键为 zip 内路径；插入序即打包序，首条目应为 mimetype） */
  entries: Readonly<Record<string, Uint8Array>>;
  /** OPF package 版本（'2.0' / '3.0'） */
  version: string;
  /** 单文档字节上限（与 splitSections 同阈值） */
  maxSectionBytes?: number;
}

/** 单文档体积告警阈值比例（超上限 ERROR，超半数 WARNING） */
const DOC_WARN_RATIO = 0.5;

/** 平台上传体积参考线（京东读书 / 微信读书导入上限量级；超限仅告警） */
const TOTAL_SIZE_WARN_BYTES = 20 * 1024 * 1024;

/** void 元素（XML 里自闭合；出现开标签不配对时报错） */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'img', 'hr', 'br', 'meta', 'link', 'input', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr',
]);

/**
 * 校验导出条目表，返回问题列表（error 优先于 warning 排序）
 *
 * 纯函数：不抛异常，坏输入也转化为问题条目。
 */
export function validateEpub(input: ValidateEpubInput): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const entries = input.entries;
  const names = Object.keys(entries);
  const nameSet = new Set(names);
  const maxBytes = input.maxSectionBytes ?? 256 * 1024;

  const error = (code: string, message: string, path?: string): void => {
    problems.push({ severity: 'error', code, message, path });
  };
  const warn = (code: string, message: string, path?: string): void => {
    problems.push({ severity: 'warning', code, message, path });
  };
  const text = (name: string): string | undefined => {
    const bytes = entries[name];
    return bytes === undefined ? undefined : new TextDecoder('utf-8').decode(bytes);
  };

  /* ---------- OCF 容器 ---------- */
  if (names[0] !== 'mimetype') {
    error('OCF-01', `zip 首条目应为 mimetype，实际为 ${names[0] ?? '(空)'}`, names[0]);
  } else {
    const mime = text('mimetype') ?? '';
    if (mime !== 'application/epub+zip') {
      error('OCF-02', `mimetype 内容应为 application/epub+zip，实际为 ${mime}`);
    }
  }
  if (!nameSet.has('META-INF/container.xml')) {
    error('OCF-03', '缺少 META-INF/container.xml');
  }

  /* ---------- 定位 OPF（经 container.xml；退化扫描） ---------- */
  let opfPath: string | undefined;
  const container = text('META-INF/container.xml');
  if (container !== undefined) {
    const m = /full-path="([^"]+)"/.exec(container);
    if (m?.[1] !== undefined) {
      opfPath = m[1];
      if (!nameSet.has(opfPath)) {
        error('OCF-04', `container.xml 指向的 OPF 不存在: ${opfPath}`, opfPath);
        opfPath = undefined;
      }
    } else {
      error('OCF-05', 'container.xml 未声明 rootfile full-path');
    }
  }
  if (opfPath === undefined) {
    opfPath = names.find((n) => n.endsWith('.opf'));
    if (opfPath === undefined) {
      error('OCF-06', '包内无 OPF 文件');
      return sortProblems(problems);
    }
  }
  const opf = text(opfPath) ?? '';
  const opfDir = dirOf(opfPath);
  const resolveEntry = (href: string): string =>
    normalizePath(opfDir === '' ? href : `${opfDir}/${href}`);

  /* ---------- OPF 版本与标识 ---------- */
  const versionMatch = /<package[^>]*\sversion="([^"]+)"/.exec(opf);
  const version = versionMatch?.[1] ?? input.version;
  if (version !== '2.0' && version !== '3.0') {
    error('PKG-01', `OPF version 仅支持 2.0 / 3.0，实际为 ${version}`, opfPath);
  }
  const epub3 = version === '3.0';
  const uniqueId = /unique-identifier="([^"]+)"/.exec(opf)?.[1];
  const identifierMatch =
    uniqueId !== undefined
      ? new RegExp(`<dc:identifier id="${escapeRe(uniqueId)}">([^<]*)</dc:identifier>`).exec(opf)
      : undefined;
  const identifier = identifierMatch?.[1];
  if (identifier === undefined || identifier === '') {
    error('PKG-02', 'OPF 缺少 unique-identifier 指向的 dc:identifier', opfPath);
  }

  /* ---------- manifest / spine 交叉一致 ---------- */
  const manifestItems: Array<{ id: string; href: string; mediaType: string; properties?: string }> = [];
  const itemRe = /<item\s+([^>]*?)\/?>/g;
  for (const m of opf.matchAll(itemRe)) {
    const attrs = m[1] ?? '';
    const id = /id="([^"]*)"/.exec(attrs)?.[1];
    const href = /href="([^"]*)"/.exec(attrs)?.[1];
    const mediaType = /media-type="([^"]*)"/.exec(attrs)?.[1];
    const properties = /properties="([^"]*)"/.exec(attrs)?.[1];
    if (id === undefined || href === undefined || mediaType === undefined) continue;
    manifestItems.push({ id, href, mediaType, properties });
  }
  const manifestIds = new Set(manifestItems.map((i) => i.id));
  for (const item of manifestItems) {
    const target = resolveEntry(item.href);
    if (!nameSet.has(target)) {
      error('PKG-03', `manifest 条目在包内不存在: ${item.href}`, item.href);
    }
  }
  const spineRefs = [...opf.matchAll(/<itemref\s+[^>]*idref="([^"]*)"/g)].map((m) => m[1] ?? '');
  if (spineRefs.length === 0) {
    error('PKG-04', 'spine 为空：阅读器无可渲染内容文档', opfPath);
  }
  for (const ref of spineRefs) {
    if (!manifestIds.has(ref)) {
      error('PKG-05', `spine idref 无对应 manifest item: ${ref}`, opfPath);
    }
  }

  /* ---------- 目录（nav / ncx） ---------- */
  const navItem = manifestItems.find((i) => i.properties?.includes('nav') === true);
  const ncxItem = manifestItems.find((i) => i.mediaType === 'application/x-dtbncx+xml');
  if (epub3) {
    if (navItem === undefined) {
      warn('NAV-01', 'EPUB 3 包未声明 properties="nav" 的导航文档', opfPath);
    }
  } else if (ncxItem === undefined) {
    error('NAV-02', 'EPUB 2 包缺少 toc.ncx（RMSDK 目录来源）', opfPath);
  }
  if (ncxItem !== undefined) {
    const ncxPath = resolveEntry(ncxItem.href);
    const ncx = text(ncxPath);
    if (ncx !== undefined) {
      const uid = extractMetaContent(ncx, 'dtb:uid');
      if (uid !== identifier && identifier !== undefined && identifier !== '') {
        error('NAV-03', `toc.ncx 的 dtb:uid(${uid}) 与 OPF dc:identifier(${identifier}) 不一致`, ncxPath);
      }
      /* navPoint content src 目标 + 锚点存在性 */
      for (const m of ncx.matchAll(/<content\s+src="([^"]*)"/g)) {
        checkNavTarget(m[1] ?? '', 'NAV-04', error, warn, opfDir, nameSet, text);
      }
    }
  }
  if (navItem !== undefined) {
    const navPath = resolveEntry(navItem.href);
    const nav = text(navPath);
    if (nav !== undefined) {
      for (const m of nav.matchAll(/<a\s+[^>]*href="([^"]*)"/g)) {
        checkNavTarget(m[1] ?? '', 'NAV-05', error, warn, opfDir, nameSet, text);
      }
    }
  }

  /* ---------- 内容文档：体积 / XML / 媒体引用 / CSS ---------- */
  const contentItems = manifestItems.filter((i) => i.mediaType === 'application/xhtml+xml');
  const cssEntries = names.filter((n) => n.toLowerCase().endsWith('.css'));
  let totalBytes = 0;
  for (const name of names) totalBytes += entries[name]?.byteLength ?? 0;
  if (totalBytes > TOTAL_SIZE_WARN_BYTES) {
    warn('SIZE-01', `包总体积 ${(totalBytes / 1048576).toFixed(1)}MB 超过平台常见上传上限（约 20MB）`);
  }

  for (const item of contentItems) {
    const path = resolveEntry(item.href);
    const body = text(path);
    if (body === undefined) continue;
    const bytes = entries[path]?.byteLength ?? 0;
    if (bytes > maxBytes) {
      error('DOC-01', `内容文档 ${(bytes / 1024).toFixed(0)}KB 超过单文档上限 ${(maxBytes / 1024).toFixed(0)}KB（阅读器可能拒绝加载）`, path);
    } else if (bytes > maxBytes * DOC_WARN_RATIO) {
      warn('DOC-02', `内容文档 ${(bytes / 1024).toFixed(0)}KB 接近单文档上限`, path);
    }
    /* BOM */
    const raw = entries[path];
    if (raw !== undefined && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
      error('XML-02', '内容文档带 UTF-8 BOM（RMSDK 可能拒开）', path);
    }
    /* 格式良好（轻量检查器） */
    const wf = checkWellFormedXml(body);
    if (wf !== undefined) {
      error('XML-01', `内容文档非格式良好: ${wf}`, path);
    }
    /* 图片引用 */
    for (const m of body.matchAll(/<img\s+[^>]*src="([^"]*)"/g)) {
      const src = m[1] ?? '';
      if (src === '') continue;
      if (src.startsWith('data:')) {
        warn('MEDIA-02', '图片仍为 data URI（未打包为独立文件）：RMSDK 兼容性差且撑大文档', path);
      } else if (/^(?:blob:|file:)/i.test(src)) {
        warn('MEDIA-03', `图片为会话本地地址（${src.slice(0, 24)}…）：阅读端必然失效`, path);
      } else if (/^(?:https?|ftp):/i.test(src) || src.startsWith('//')) {
        warn('MEDIA-04', '外链图片：阅读端需联网，平台审核可能要求包内资源', path);
      } else {
        /* 相对路径：相对内容文档解析 */
        const target = normalizePath(`${dirOf(path)}/${src.split('#')[0] ?? ''}`);
        if (!nameSet.has(target)) {
          error('MEDIA-01', `图片死链：包内不存在 ${src}`, path);
        }
      }
    }
  }

  for (const cssName of cssEntries) {
    const css = text(cssName);
    if (css === undefined) continue;
    if (/var\(--/.test(css)) {
      warn('CSS-01', '样式表使用 CSS 变量：不支持 var() 的老引擎（RMSDK / 微信读书）会丢弃全部相关声明', cssName);
    }
    /* 仅直排需要前缀降级：横排 writing-mode 是老引擎的默认行为，无需告警 */
    const verticalMatch = /writing-mode\s*:\s*([^;}]+)/.exec(css);
    if (verticalMatch !== null && /vertical/i.test(verticalMatch[1] ?? '') && !/-webkit-writing-mode\s*:/.test(css)) {
      warn('CSS-02', '直排 writing-mode 无 -webkit- 前缀：老 WebKit 内核直排失效', cssName);
    }
  }

  return sortProblems(problems);
}

/** 校验 nav/ncx 的单个跳转目标（文件存在 + 锚点 id 存在） */
function checkNavTarget(
  href: string,
  code: string,
  error: (code: string, message: string, path?: string) => void,
  warn: (code: string, message: string, path?: string) => void,
  opfDir: string,
  nameSet: ReadonlySet<string>,
  text: (name: string) => string | undefined,
): void {
  if (href === '' || href.startsWith('#')) return;
  const [file, fragment] = splitHref(href);
  if (/^(?:https?|mailto:)/i.test(file)) {
    warn(code, `外链跳转: ${href}`);
    return;
  }
  const target = normalizePath(opfDir === '' ? file : `${opfDir}/${file}`);
  if (!nameSet.has(target)) {
    error(code, `目录跳转目标不存在: ${href}`, href);
    return;
  }
  if (fragment !== undefined && fragment !== '') {
    const body = text(target);
    if (body !== undefined && !new RegExp(`id="${escapeRe(fragment)}"`).test(body)) {
      error(code, `目录锚点 #${fragment} 在 ${file} 中不存在`, href);
    }
  }
}

/** error 优先，同级按 code 排序（稳定输出） */
function sortProblems(problems: ValidationProblem[]): ValidationProblem[] {
  const rank = (p: ValidationProblem): number => (p.severity === 'error' ? 0 : 1);
  return problems.slice().sort((a, b) => rank(a) - rank(a) || a.code.localeCompare(b.code) || (a.path ?? '').localeCompare(b.path ?? ''));
}

/** href → [文件, 锚点] */
function splitHref(href: string): [string, string | undefined] {
  const hash = href.indexOf('#');
  return hash === -1 ? [href, undefined] : [href.slice(0, hash), href.slice(hash + 1)];
}

/**
 * 从 XML 文本提取 `<meta name="X" content="Y"/>` 的 content 值
 *
 * 属性顺序不固定（我们的 ncx 生成器写 content 在前），故先定位含目标 name 的
 * 整个 meta 元素，再在元素内取 content。
 */
function extractMetaContent(xml: string, name: string): string | undefined {
  for (const m of xml.matchAll(/<meta\s+[^>]*\/>/g)) {
    const element = m[0];
    if (!new RegExp(`name="${escapeRe(name)}"`).test(element)) continue;
    return /content="([^"]*)"/.exec(element)?.[1];
  }
  return undefined;
}

/** 路径规范化（合并 ./ 与 ../，统一正斜杠） */
function normalizePath(path: string): string {
  const parts = path.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

/** 目录部分（不含末段） */
function dirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** 正则转义 */
function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 轻量 XML 格式良好检查（标签配对 + 属性引号 + 结构扫描）
 *
 * 不追求完整 XML 规范（无 DTD / 实体 / 命名空间校验），覆盖导出产物
 * 的全部实际风险：未闭合标签、错配闭标签、未加引号的属性值、
 * 文本区裸露 `<`。返回 undefined 表示通过，否则为问题描述。
 */
export function checkWellFormedXml(xml: string): string | undefined {
  const stack: string[] = [];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;
    /* 文本区裸 < 之后必须紧跟合法名字起始字符 / / / ! / ? */
    const next = xml[lt + 1];
    if (next === undefined) return `位置 ${lt}: '<' 后无内容`;
    if (!/[A-Za-z_/!?]/.test(next)) {
      return `位置 ${lt}: 文本区裸露 '<'（后跟 '${next}'）`;
    }
    if (next === '?') {
      const end = xml.indexOf('?>', lt);
      if (end === -1) return `位置 ${lt}: 处理指令未闭合`;
      i = end + 2;
      continue;
    }
    if (next === '!') {
      if (xml.startsWith('<!--', lt)) {
        const end = xml.indexOf('-->', lt);
        if (end === -1) return `位置 ${lt}: 注释未闭合`;
        i = end + 3;
        continue;
      }
      if (xml.startsWith('<![CDATA[', lt)) {
        const end = xml.indexOf(']]>', lt);
        if (end === -1) return `位置 ${lt}: CDATA 未闭合`;
        i = end + 3;
        continue;
      }
      /* DOCTYPE：扫描到匹配 '>'（跳过内部子集的方括号） */
      let j = lt + 2;
      let depth = 0;
      while (j < n) {
        const ch = xml[j];
        if (ch === '[') depth += 1;
        else if (ch === ']') depth -= 1;
        else if (ch === '>' && depth <= 0) break;
        j += 1;
      }
      if (j >= n) return `位置 ${lt}: DOCTYPE 未闭合`;
      i = j + 1;
      continue;
    }
    if (next === '/') {
      const end = xml.indexOf('>', lt);
      if (end === -1) return `位置 ${lt}: 闭标签未闭合`;
      const name = xml.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (top === undefined) return `位置 ${lt}: 闭标签 </${name}> 无对应开标签`;
      if (top !== name) return `位置 ${lt}: 闭标签 </${name}> 与开标签 <${top}> 错配`;
      i = end + 1;
      continue;
    }
    /* 开标签：解析名字与属性，判断自闭合 */
    const parsed = parseOpenTag(xml, lt);
    if (parsed.error !== undefined) return `位置 ${lt}: ${parsed.error}`;
    if (parsed.name === undefined || parsed.end === undefined) return `位置 ${lt}: 开标签解析失败`;
    if (parsed.selfClosing || VOID_ELEMENTS.has(parsed.name)) {
      i = parsed.end;
      continue;
    }
    stack.push(parsed.name);
    i = parsed.end;
  }
  if (stack.length > 0) {
    return `文档结束时未闭合标签: <${stack.join('>, <')}>`;
  }
  return undefined;
}

/** 解析开标签（名字 / 自闭合 / 属性引号合法性），end 为 '>' 之后的位置 */
function parseOpenTag(
  xml: string,
  start: number,
): { name?: string; end?: number; selfClosing?: boolean; error?: string } {
  const nameMatch = /^<([A-Za-z_][\w.:-]*)/.exec(xml.slice(start));
  if (nameMatch === null) return { error: '非法标签名' };
  const name = nameMatch[1] ?? '';
  let i = start + nameMatch[0].length;
  const n = xml.length;
  while (i < n) {
    const ch = xml[i];
    if (ch === '>') {
      return { name, end: i + 1, selfClosing: xml[i - 1] === '/' };
    }
    if (ch === '/' && xml[i + 1] === '>') {
      return { name, end: i + 2, selfClosing: true };
    }
    if (/\s/.test(ch ?? '')) {
      i += 1;
      continue;
    }
    /* 属性名 */
    const attrMatch = /^([\w.:-]+)\s*=\s*/.exec(xml.slice(i));
    if (attrMatch === null) {
      return { error: `属性语法错误（位置 ${i}，字符 '${ch}'）` };
    }
    i += attrMatch[0].length;
    const quote = xml[i];
    if (quote !== '"' && quote !== "'") {
      return { error: `属性值未加引号（位置 ${i}）` };
    }
    const close = xml.indexOf(quote, i + 1);
    if (close === -1) return { error: '属性值引号未闭合' };
    i = close + 1;
  }
  return { error: '开标签未闭合' };
}
