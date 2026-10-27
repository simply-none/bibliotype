/**
 * EPUB 3 nav.xhtml 解析测试
 *
 * 重点验证「层级不丢」与「href 以 nav 自身目录为基准」——这两点正是旧实现
 * 只读 NCX 时目录被拍平、以及 NCX 放在子目录后标题退化成「第N节」的根因。
 */
import { describe, expect, it } from 'vitest';
import { parseNavToc } from '../toc-nav.js';

/** 包一层最小 nav.xhtml（`epub` 前缀必须声明） */
function navDoc(inner: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">' +
    `<head><title>目录</title></head><body><nav epub:type="toc">${inner}</nav></body></html>`
  );
}

describe('parseNavToc', () => {
  it('递归解析 ol > li > a 的三级目录，层级原样保留', () => {
    const entries = parseNavToc(
      navDoc(
        '<ol>' +
          '<li><a href="text/v1.xhtml">卷一</a><ol>' +
          '<li><a href="text/v1.xhtml#ch1">第一章</a><ol>' +
          '<li><a href="text/v1.xhtml#s1">第一节</a></li>' +
          '</ol></li>' +
          '<li><a href="text/v1.xhtml#ch2">第二章</a></li>' +
          '</ol></li>' +
          '</ol>',
      ),
      'OEBPS/',
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ title: '卷一', docPath: 'OEBPS/text/v1.xhtml', anchor: '' });
    expect(entries[0]?.children.map((child) => child.title)).toEqual(['第一章', '第二章']);
    expect(entries[0]?.children[0]?.children).toEqual([
      { title: '第一节', docPath: 'OEBPS/text/v1.xhtml', anchor: 's1', children: [] },
    ]);
  });

  it('无 href 的 span 分组标题不继承子条目文档（避免父子抢同一锚点）', () => {
    const entries = parseNavToc(
      navDoc(
        '<ol><li><span>上卷</span><ol>' +
          '<li><a href="text/ch1.xhtml#c1">第一章</a></li>' +
          '</ol></li></ol>',
      ),
      'OEBPS/',
    );

    expect(entries[0]).toMatchObject({ title: '上卷', docPath: '', anchor: '' });
    expect(entries[0]?.children[0]?.docPath).toBe('OEBPS/text/ch1.xhtml');
  });

  it('href 相对 nav 自身目录解析，锚点做 URL 解码', () => {
    const entries = parseNavToc(
      navDoc('<ol><li><a href="../text/ch1.xhtml#%E4%B8%80">一</a></li></ol>'),
      'OEBPS/nav/',
    );

    expect(entries[0]).toMatchObject({
      title: '一',
      docPath: 'OEBPS/text/ch1.xhtml',
      anchor: '一',
    });
  });

  it('找不到目录型 nav 时返回空数组（交由 ncx 或扁平回退）', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">' +
      '<body><nav epub:type="landmarks"><ol><li><a href="text/ch1.xhtml">正文</a></li></ol>' +
      '</nav></body></html>';
    expect(parseNavToc(xml, 'OEBPS/')).toEqual([]);
  });
});
