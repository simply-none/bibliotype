/**
 * 版心（书口）HTML 序列化测试
 *
 * 三端（阅读 / 编辑分页 / 打印）共用同一份产出，这里的断言同时是三端的
 * 契约：字段顺序、空字段跳过、鱼尾数量、属性与转义。
 */
import { describe, expect, it } from 'vitest';
import { serializePageGutter } from '../html/page-gutter.js';
import {
  GUTTER_FISH_TAILS,
  GUTTER_MOUTHS,
  GUTTER_SIDES,
  type FacsimileOptions,
} from '../facsimile.js';

/** 构造仿真配置 */
function facsimile(patch: Partial<NonNullable<FacsimileOptions['gutter']>> = {}): FacsimileOptions {
  return {
    preset: 'song-zhe',
    frame: 'double',
    rule: 'ink',
    gutter: {
      side: GUTTER_SIDES.LEFT,
      size: 34,
      mouth: GUTTER_MOUTHS.WHITE,
      fishTail: GUTTER_FISH_TAILS.SINGLE,
      fields: ['bookTitle', 'chapterTitle', 'pageNumber'],
      ...patch,
    },
  };
}

describe('serializePageGutter', () => {
  it('按字段顺序输出竖写文本，并带位置 / 口子 / 鱼尾属性', () => {
    const html = serializePageGutter(
      { bookTitle: '论语', chapterTitle: '学而第一', pageNumber: '七' },
      facsimile(),
    );
    expect(html).toContain('class="bt-page-gutter"');
    expect(html).toContain('data-side="left"');
    expect(html).toContain('data-mouth="white"');
    expect(html).toContain('data-fish="single"');
    expect(html.indexOf('论语')).toBeLessThan(html.indexOf('学而第一'));
    expect(html.indexOf('学而第一')).toBeLessThan(html.indexOf('>七<'));
    expect(html.match(/bt-page-gutter__field/g)).toHaveLength(3);
  });

  it('空字段跳过，不产生空行', () => {
    const html = serializePageGutter({ bookTitle: '论语', chapterTitle: '', pageNumber: '七' }, facsimile());
    expect(html.match(/bt-page-gutter__field/g)).toHaveLength(2);
    expect(html).not.toContain('data-field="chapterTitle"');
  });

  it('字段被裁掉时连同其文本一起不输出', () => {
    const html = serializePageGutter(
      { bookTitle: '论语', chapterTitle: '学而第一', pageNumber: '七' },
      facsimile({ fields: ['pageNumber'] }),
    );
    expect(html).not.toContain('论语');
    expect(html).toContain('data-field="pageNumber"');
  });

  it('鱼尾数量随配置：单 / 双 / 无', () => {
    const count = (fishTail: 'none' | 'single' | 'double') =>
      (serializePageGutter(
        { bookTitle: '论语', chapterTitle: '', pageNumber: '一' },
        facsimile({ fishTail }),
      ).match(/bt-page-gutter__fish/g) ?? []).length;
    expect(count('single')).toBe(1);
    expect(count('double')).toBe(2);
    expect(count('none')).toBe(0);
  });

  it('文本做 HTML 转义（书名可能含标点 / 尖括号）', () => {
    const html = serializePageGutter(
      { bookTitle: '<论语>', chapterTitle: '', pageNumber: '' },
      facsimile({ fields: ['bookTitle'] }),
    );
    expect(html).toContain('&lt;论语&gt;');
    expect(html).not.toContain('<论语>');
  });

  it('未配置版心 / 字段全为空时返回空串（调用方直接拼入也安全）', () => {
    expect(serializePageGutter({ bookTitle: '论语', chapterTitle: '', pageNumber: '' }, undefined)).toBe('');
    expect(
      serializePageGutter(
        { bookTitle: '论语', chapterTitle: '', pageNumber: '' },
        facsimile({ fields: [] }),
      ),
    ).toBe('');
    expect(
      serializePageGutter(
        { bookTitle: '', chapterTitle: '', pageNumber: '' },
        facsimile(),
      ),
    ).toBe('');
  });
});
