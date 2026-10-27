/**
 * 目录/正文路径工具测试（纯函数）
 *
 * 覆盖三类历史故障：
 * - href 解析基准错（NCX 在子目录时全部失配）；
 * - zip 条目名大小写 / 转义不一致导致整篇静默跳过；
 * - 正文顺序只信 spine，忽略目录里的真实阅读顺序。
 */
import { describe, expect, it } from 'vitest';
import { orderContentPaths, resolveHref, lookupEntry } from '../toc-path.js';
import type { EpubFiles, TocEntry } from '../toc-types.js';

/** 造一个只有路径没有内容的条目表（本测试不读字节） */
function filesOf(...paths: string[]): EpubFiles {
  const files: EpubFiles = {};
  for (const path of paths) files[path] = new Uint8Array(0);
  return files;
}

/** 造目录条目 */
function entry(docPath: string, children: TocEntry[] = [], title = docPath): TocEntry {
  return { title, docPath, anchor: '', children };
}

describe('resolveHref', () => {
  it('折叠 . 与 ..，并去掉锚点与查询', () => {
    expect(resolveHref('OEBPS/nav/', '../text/ch1.xhtml#c1')).toBe('OEBPS/text/ch1.xhtml');
    expect(resolveHref('OEBPS/', './text/ch1.xhtml?v=2#c1')).toBe('OEBPS/text/ch1.xhtml');
  });

  it('对 URL 转义的路径做解码（目录里的 %20 与实际条目名对得上）', () => {
    expect(resolveHref('OEBPS/', 'text/%E7%AC%AC%E4%B8%80%E7%AB%A0.xhtml')).toBe(
      'OEBPS/text/第一章.xhtml',
    );
  });
});

describe('lookupEntry', () => {
  it('精确命中时原样返回条目名', () => {
    const files = filesOf('OEBPS/text/ch1.xhtml');
    expect(lookupEntry(files, 'OEBPS/text/ch1.xhtml')).toBe('OEBPS/text/ch1.xhtml');
  });

  it('大小写不一致时仍返回实际 zip 条目名（正文不丢）', () => {
    const files = filesOf('OEBPS/Text/Ch1.XHTML');
    expect(lookupEntry(files, 'OEBPS/text/ch1.xhtml')).toBe('OEBPS/Text/Ch1.XHTML');
  });

  it('条目名带 URL 转义时按解码后的形态命中', () => {
    const files = filesOf('OEBPS/text/第一章.xhtml');
    expect(lookupEntry(files, 'OEBPS/text/%E7%AC%AC%E4%B8%80%E7%AB%A0.xhtml')).toBe(
      'OEBPS/text/第一章.xhtml',
    );
  });

  it('确实不存在时返回 undefined（由调用方记入报告，不静默）', () => {
    expect(lookupEntry(filesOf('OEBPS/text/ch1.xhtml'), 'OEBPS/text/ch9.xhtml')).toBeUndefined();
  });
});

describe('orderContentPaths', () => {
  it('以目录先序为主序重排（spine 顺序与目录相反时按目录输出）', () => {
    const contentPaths = ['OEBPS/b.xhtml', 'OEBPS/a.xhtml'];
    const entries = [entry('OEBPS/a.xhtml'), entry('OEBPS/b.xhtml')];
    expect(orderContentPaths(contentPaths, entries)).toEqual(['OEBPS/a.xhtml', 'OEBPS/b.xhtml']);
  });

  it('未收录文档插到「spine 中它之前且已在主序中」的文档之后', () => {
    const contentPaths = ['OEBPS/cover.xhtml', 'OEBPS/a.xhtml', 'OEBPS/b.xhtml'];
    const entries = [entry('OEBPS/a.xhtml'), entry('OEBPS/b.xhtml')];
    expect(orderContentPaths(contentPaths, entries)).toEqual([
      'OEBPS/cover.xhtml',
      'OEBPS/a.xhtml',
      'OEBPS/b.xhtml',
    ]);
  });

  it('目录指向但 spine 未声明的文档被丢弃（不引入额外正文）', () => {
    const contentPaths = ['OEBPS/a.xhtml'];
    const entries = [entry('OEBPS/a.xhtml'), entry('OEBPS/nav-only.xhtml')];
    expect(orderContentPaths(contentPaths, entries)).toEqual(['OEBPS/a.xhtml']);
  });

  it('嵌套条目按先序展开（父条目文档先于子条目文档）', () => {
    const contentPaths = ['OEBPS/s1.xhtml', 'OEBPS/v1.xhtml'];
    const entries = [entry('OEBPS/v1.xhtml', [entry('OEBPS/s1.xhtml')])];
    expect(orderContentPaths(contentPaths, entries)).toEqual(['OEBPS/v1.xhtml', 'OEBPS/s1.xhtml']);
  });
});
