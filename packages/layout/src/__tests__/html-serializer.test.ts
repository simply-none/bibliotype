/**
 * IR → HTML 序列化器测试
 */
import { describe, expect, it } from 'vitest';
import { MARK_TYPES, NODE_TYPES, type BookNode } from '@bibliotype/core';
import { escapeHtml, serializeNode } from '../html/html-serializer.js';

describe('escapeHtml', () => {
  it('转义五个实体字符', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('元素与结构', () => {
  it('段落：class 与文本转义', () => {
    const root: BookNode = {
      type: NODE_TYPES.PARAGRAPH,
      children: [{ type: 'text', text: '子曰：学而时习之 & 不亦说乎？' }],
    };
    expect(serializeNode(root)).toBe(
      '<p class="bt-paragraph">子曰：学而时习之 &amp; 不亦说乎？</p>',
    );
  });

  it('嵌套结构：book 透明、结构节点 section、id 与 data-* 属性', () => {
    const root: BookNode = {
      type: NODE_TYPES.BOOK,
      children: [
        {
          type: NODE_TYPES.VOLUME,
          id: 'vol-1',
          attrs: { title: '卷一' },
          children: [
            {
              type: NODE_TYPES.CHAPTER,
              id: 'c1',
              children: [
                {
                  type: NODE_TYPES.PARAGRAPH,
                  id: 'p1',
                  children: [{ type: 'text', text: '正文' }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(serializeNode(root)).toBe(
      '<section id="vol-1" class="bt-volume" data-title="卷一">' +
        '<section id="c1" class="bt-chapter">' +
        '<p id="p1" class="bt-paragraph">正文</p>' +
        '</section></section>',
    );
  });

  it('heading：level 映射 h1~h6 并钳制，缺省 h1（与 spec 默认对齐，R3）', () => {
    expect(
      serializeNode({
        type: NODE_TYPES.HEADING,
        attrs: { level: 3 },
        children: [{ type: 'text', text: '章一' }],
      }),
    ).toBe('<h3 class="bt-heading" data-level="3">章一</h3>');

    // 省略 level（等于 spec 默认值 1）时回退 h1，不再退化成 h2
    expect(serializeNode({ type: NODE_TYPES.HEADING, children: [] })).toBe(
      '<h1 class="bt-heading"></h1>',
    );
    expect(serializeNode({ type: NODE_TYPES.HEADING, attrs: { level: 9 } })).toBe(
      '<h6 class="bt-heading" data-level="9"></h6>',
    );
  });

  it('list：ordered 决定 ol / ul', () => {
    const list: BookNode = {
      type: NODE_TYPES.LIST,
      attrs: { ordered: true },
      children: [
        { type: NODE_TYPES.LIST_ITEM, children: [{ type: 'text', text: '甲' }] },
      ],
    };
    expect(serializeNode(list)).toBe(
      '<ol class="bt-list" data-ordered="true"><li class="bt-list-item">甲</li></ol>',
    );

    expect(serializeNode({ ...list, attrs: {} })).toBe(
      '<ul class="bt-list"><li class="bt-list-item">甲</li></ul>',
    );
  });

  it('image：src/alt/width/height 原生透传、其余属性 data-*、自闭合', () => {
    expect(
      serializeNode({
        type: NODE_TYPES.IMAGE,
        attrs: { src: 'cover.jpg', alt: '封面', width: 600, height: 400 },
      }),
    ).toBe('<img class="bt-image" src="cover.jpg" alt="封面" width="600" height="400" />');

    /* 非法尺寸不输出；其余属性仍走 data-* */
    expect(
      serializeNode({
        type: NODE_TYPES.IMAGE,
        attrs: { src: 'x.png', width: 0, height: -1, title: '插图' },
      }),
    ).toBe('<img class="bt-image" src="x.png" alt="" data-title="插图" />');
  });

  it('glyph-image：行内字图自闭合，原字走 data-char，原始尺寸不输出', () => {
    expect(
      serializeNode({
        type: NODE_TYPES.GLYPH_IMAGE,
        attrs: { src: 'z/zhi.png', alt: '贔', char: '贔', width: 24, height: 24 },
      }),
    ).toBe('<img class="bt-glyph-image" src="z/zhi.png" alt="贔" data-char="贔" />');

    /* 无 char：仅 src/alt */
    expect(serializeNode({ type: NODE_TYPES.GLYPH_IMAGE, attrs: { src: 'z.png' } })).toBe(
      '<img class="bt-glyph-image" src="z.png" alt="" />',
    );
  });

  it('glyph-image 随段落序列化为行内 img（不独立成块）', () => {
    expect(
      serializeNode({
        type: NODE_TYPES.PARAGRAPH,
        children: [
          { type: 'text', text: '五载，' },
          { type: NODE_TYPES.GLYPH_IMAGE, attrs: { src: 'z.png', alt: '贔', char: '贔' } },
          { type: 'text', text: '耻难事发，' },
        ],
      }),
    ).toBe(
      '<p class="bt-paragraph">五载，<img class="bt-glyph-image" src="z.png" alt="贔" data-char="贔" />耻难事发，</p>',
    );
  });

  it('break：自闭合 hr 并携 variant', () => {
    expect(serializeNode({ type: NODE_TYPES.BREAK, attrs: { variant: 'section' } })).toBe(
      '<hr class="bt-break" data-variant="section" />',
    );
  });

  it('code-block：逐字输出（不解析内部标记化）', () => {
    const code: BookNode = {
      type: NODE_TYPES.CODE_BLOCK,
      attrs: { language: 'ts' },
      children: [{ type: 'text', text: 'const a = 1 < 2;' }],
    };
    expect(serializeNode(code)).toBe(
      '<pre class="bt-code-block" data-language="ts"><code>const a = 1 &lt; 2;</code></pre>',
    );
  });

  it('math：data-tex 携源码，子内容缺省回退 tex 文本', () => {
    expect(serializeNode({ type: NODE_TYPES.MATH_INLINE, attrs: { tex: 'x^2' } })).toBe(
      '<span class="bt-math-inline" data-tex="x^2">x^2</span>',
    );
    expect(
      serializeNode({
        type: NODE_TYPES.MATH_BLOCK,
        attrs: { tex: 'a+b' },
        children: [{ type: 'text', text: 'a + b' }],
      }),
    ).toBe('<div class="bt-math-block" data-tex="a+b">a + b</div>');
  });
});

describe('标记（marks）', () => {
  it('marks[0] 最内层：自内向外逐层包裹', () => {
    const root: BookNode = {
      type: NODE_TYPES.PARAGRAPH,
      children: [
        {
          type: 'text',
          text: '学而',
          marks: [
            { type: MARK_TYPES.STRONG },
            { type: MARK_TYPES.LINK, attrs: { href: 'https://example.com' } },
          ],
        },
      ],
    };
    expect(serializeNode(root)).toBe(
      '<p class="bt-paragraph">' +
        '<a class="bt-mark-link" href="https://example.com"><strong>学而</strong></a>' +
        '</p>',
    );
  });

  it('ruby：注文输出为 rt', () => {
    expect(
      serializeNode({
        type: NODE_TYPES.PARAGRAPH,
        children: [
          { type: 'text', text: '子曰', marks: [{ type: MARK_TYPES.RUBY, attrs: { text: 'zǐ yuē' } }] },
        ],
      }),
    ).toBe('<p class="bt-paragraph"><ruby>子曰<rt>zǐ yuē</rt></ruby></p>');
  });

  it('link 缺 href 时退化为 span；未知标记输出 bt-mark-* span', () => {
    expect(
      serializeNode({
        type: NODE_TYPES.PARAGRAPH,
        children: [{ type: 'text', text: 'x', marks: [{ type: MARK_TYPES.LINK }] }],
      }),
    ).toBe('<p class="bt-paragraph"><span class="bt-mark-link">x</span></p>');

    expect(
      serializeNode({
        type: NODE_TYPES.PARAGRAPH,
        children: [{ type: 'text', text: 'y', marks: [{ type: 'plugin-mark', attrs: { k: 1 } }] }],
      }),
    ).toBe(
      '<p class="bt-paragraph"><span class="bt-mark-plugin-mark" data-k="1">y</span></p>',
    );
  });
});

describe('兜底与扩展', () => {
  it('未知类型：含元素子节点 → div；纯文本叶子 → span', () => {
    expect(
      serializeNode({
        type: 'custom-block',
        children: [
          { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: 'x' }] },
        ],
      }),
    ).toBe('<div class="bt-custom-block"><p class="bt-paragraph">x</p></div>');

    expect(serializeNode({ type: 'custom-inline', children: [{ type: 'text', text: 'y' }] })).toBe(
      '<span class="bt-custom-inline">y</span>',
    );
  });

  it('古籍节点启发式：double-note 容器 → div；collation-mark 叶子 → span', () => {
    expect(
      serializeNode({
        type: 'double-note',
        children: [
          { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '注文' }] },
        ],
      }),
    ).toBe('<div class="bt-double-note"><p class="bt-paragraph">注文</p></div>');

    expect(serializeNode({ type: 'collation-mark', attrs: { symbol: '○' } })).toBe(
      '<span class="bt-collation-mark" data-symbol="○"></span>',
    );
  });

  it('anchorIds 注入：无 id 节点获得调用方锚点', () => {
    const chapter: BookNode = {
      type: NODE_TYPES.CHAPTER,
      children: [{ type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: 'x' }] }],
    };
    const anchors = new Map<BookNode, string>([[chapter, 'bt-a-1']]);
    expect(serializeNode(chapter, { anchorIds: anchors })).toBe(
      '<section id="bt-a-1" class="bt-chapter"><p class="bt-paragraph">x</p></section>',
    );
  });

  it('tagOverrides 精确覆盖兜底标签（如鱼尾 → div）', () => {
    expect(
      serializeNode(
        { type: 'fish-tail', attrs: { style: '双鱼尾' } },
        { tagOverrides: { 'fish-tail': 'div' } },
      ),
    ).toBe('<div class="bt-fish-tail" data-style="双鱼尾"></div>');
  });
});

describe('注释块', () => {
  const footnote: BookNode = {
    type: NODE_TYPES.FOOTNOTE,
    id: 'fn-1',
    attrs: { marker: '1' },
    children: [{ type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '注文' }] }],
  };

  it('注码注入首个段落内部，与注文同起一行；marker 不再重复输出 data-*', () => {
    expect(serializeNode(footnote)).toBe(
      '<aside id="fn-1" class="bt-footnote" data-note-id="fn-1"><p class="bt-paragraph">' +
        '<span class="bt-note-marker">1</span>注文</p></aside>',
    );
  });

  it('epubSemantics 开启时按角色输出 epub:type（缺省关闭）', () => {
    const endnote: BookNode = {
      type: NODE_TYPES.ENDNOTE,
      attrs: { marker: '2' },
      children: [{ type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '尾注' }] }],
    };
    const marginNote: BookNode = {
      type: NODE_TYPES.MARGIN_NOTE,
      attrs: { marker: '3' },
      children: [{ type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '旁批' }] }],
    };
    const options = { epubSemantics: true };

    expect(serializeNode(endnote, options)).toContain('<aside class="bt-endnote" epub:type="endnote">');
    expect(serializeNode(marginNote, options)).toContain(
      '<aside class="bt-margin-note" epub:type="sidebar">',
    );
    /* 纯 HTML 出口（站点 / PDF）不带 EPUB 专属属性 */
    expect(serializeNode(endnote)).not.toContain('epub:type');
  });

  it('无注码时只输出块本身，空注释保留外壳', () => {
    expect(
      serializeNode({ type: NODE_TYPES.FOOTNOTE, children: [{ type: NODE_TYPES.PARAGRAPH }] }),
    ).toBe('<aside class="bt-footnote"><p class="bt-paragraph"></p></aside>');
    expect(serializeNode({ type: NODE_TYPES.FOOTNOTE, attrs: { marker: '5' } })).toBe(
      '<aside class="bt-footnote"><span class="bt-note-marker">5</span></aside>',
    );
  });
});

describe('目录块', () => {
  it('toc → nav，标题行与条目段落按 role 输出 data-role，条目链接保留 href', () => {
    const toc: BookNode = {
      type: NODE_TYPES.TOC,
      id: 'toc-1',
      attrs: { title: '目录' },
      children: [
        {
          type: NODE_TYPES.HEADING,
          attrs: { level: 1, role: 'toc-title' },
          children: [{ type: 'text', text: '目录' }],
        },
        {
          type: NODE_TYPES.PARAGRAPH,
          attrs: { role: 'toc-entry' },
          children: [
            { type: 'text', text: '上论', marks: [{ type: MARK_TYPES.LINK, attrs: { href: '#vol-1' } }] },
          ],
        },
      ],
    };

    expect(serializeNode(toc)).toBe(
      '<nav id="toc-1" class="bt-toc" data-title="目录">' +
        '<h1 class="bt-heading" data-level="1" data-role="toc-title">目录</h1>' +
        '<p class="bt-paragraph" data-role="toc-entry">' +
        '<a class="bt-mark-link" href="#vol-1">上论</a></p>' +
        '</nav>',
    );
  });
});

describe('注引用', () => {
  const refParagraph: BookNode = {
    type: NODE_TYPES.PARAGRAPH,
    children: [
      { type: 'text', text: '子曰' },
      {
        type: 'text',
        text: '1',
        marks: [
          { type: MARK_TYPES.NOTE_REF, attrs: { targetId: 'note-footnote-1', refId: 'ref-1' } },
        ],
      },
    ],
  };

  it('正文引用 → a + href，epubSemantics 时带 epub:type="noteref"', () => {
    expect(serializeNode(refParagraph)).toBe(
      '<p class="bt-paragraph">子曰' +
        '<a id="ref-1" class="bt-mark-noteref" href="#note-footnote-1">1</a></p>',
    );
    expect(serializeNode(refParagraph, { epubSemantics: true })).toContain(
      '<a id="ref-1" class="bt-mark-noteref" href="#note-footnote-1" epub:type="noteref">1</a>',
    );
  });

  it('注文 refId → 回跳链接 + 注码 data-note-ref；注文带 data-note-id', () => {
    const note: BookNode = {
      type: NODE_TYPES.FOOTNOTE,
      id: 'note-footnote-1',
      attrs: { marker: '1', refId: 'ref-1' },
      children: [{ type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '注文' }] }],
    };
    expect(serializeNode(note)).toBe(
      '<aside id="note-footnote-1" class="bt-footnote" data-note-id="note-footnote-1">' +
        '<p class="bt-paragraph">' +
        '<span class="bt-note-marker" data-note-ref="ref-1">1</span>注文</p>' +
        '<a class="bt-note-backref" href="#ref-1">↩</a></aside>',
    );
  });
});

describe('竖排文字形态', () => {
  it('verticalText：标点换竖排形态 + 数字汉字分组', () => {
    const node: BookNode = {
      type: NODE_TYPES.PARAGRAPH,
      children: [{ type: 'text', text: '子曰：「学而时习之。」1850年' }],
    };
    expect(serializeNode(node, { verticalText: { digits: 'kanji' } })).toBe(
      '<p class="bt-paragraph">子曰︓﹁学而时习之︒﹂一八五〇年</p>',
    );
  });

  it('缺省不转换（交给浏览器 vert 特性）', () => {
    const node: BookNode = {
      type: NODE_TYPES.PARAGRAPH,
      children: [{ type: 'text', text: '子曰：「1850」。' }],
    };
    expect(serializeNode(node)).toBe('<p class="bt-paragraph">子曰：「1850」。</p>');
  });

  it('代码块逐字输出，不受竖排转换影响', () => {
    const node: BookNode = {
      type: NODE_TYPES.CODE_BLOCK,
      children: [{ type: 'text', text: 'print("。1850")' }],
    };
    expect(serializeNode(node, { verticalText: { digits: 'kanji' } })).toContain(
      '。1850',
    );
  });

  it('glyph 回调逐字符替换缺字，缺省不影响输出', () => {
    const node: BookNode = {
      type: NODE_TYPES.PARAGRAPH,
      children: [{ type: 'text', text: '山𫞩水' }],
    };
    const plain = serializeNode(node);

    // 回调全部返回 undefined：产物与不传回调一致
    expect(serializeNode(node, { glyph: () => undefined })).toBe(plain);

    const replaced = serializeNode(node, {
      glyph: (char) => (char === '𫞩' ? '<span class="bt-glyph">合成</span>' : undefined),
    });
    expect(replaced).toContain('山');
    expect(replaced).toContain('水');
    expect(replaced).toContain('<span class="bt-glyph">合成</span>');
    expect(replaced).not.toContain('𫞩');
  });

  it('glyph 回调不影响标记包裹的结构', () => {
    const node: BookNode = {
      type: NODE_TYPES.PARAGRAPH,
      children: [
        {
          type: 'text',
          text: '𫞩',
          marks: [{ type: MARK_TYPES.STRONG }],
        },
      ],
    };
    const html = serializeNode(node, {
      glyph: () => '<span class="bt-glyph">X</span>',
    });
    expect(html).toBe(
      '<p class="bt-paragraph"><strong><span class="bt-glyph">X</span></strong></p>',
    );
  });
});
