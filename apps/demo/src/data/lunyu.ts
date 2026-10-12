/**
 * 《论语》样例数据（IR）
 *
 * 以真实阅读场景覆盖渲染链路关键点：
 * - 卷 / 章结构（目录跳转依赖节点 id 与 attrs.title）；
 * - heading 章题（level 1）；
 * - 双行小注（朱注，CLASSICAL_NODE_TYPES.DOUBLE_NOTE）；
 * - ruby 注音（MARK_TYPES.RUBY，attrs.text 携带注文）；
 * - 校勘标记（异文/专名/书名/圈点，classical 行内标记）与校勘记。
 *
 * 约定：块级节点仅含文本子节点（行内样式经 marks 表达），
 * 与 reader.extractBlocks 的"叶块 = 无元素子节点"判定保持一致，
 * 保证分页测量与渲染内容一一对应。
 */
import {
  MARK_TYPES,
  NODE_TYPES,
  createEmptyDocument,
  type BookDocument,
  type BookMark,
  type BookNode,
} from '@bibliotype/core';
import { CLASSICAL_MARK_TYPES, CLASSICAL_NODE_TYPES } from '@bibliotype/classical';

/* ---------------- 构造工具 ---------------- */

/** 文本叶子（可携带行内标记） */
function t(text: string, ...marks: BookMark[]): BookNode {
  return {
    type: NODE_TYPES.TEXT,
    text,
    ...(marks.length > 0 ? { marks } : {}),
  };
}

/** 注音标记（ruby） */
function ruby(reading: string): BookMark {
  return { type: MARK_TYPES.RUBY, attrs: { text: reading } };
}

/** 古籍行内标记（classical 命名空间） */
function classicalMark(type: string, attrs?: Record<string, string>): BookMark {
  return { type, ...(attrs !== undefined ? { attrs } : {}) };
}

/** 标题（level 1） */
function heading(id: string, text: string): BookNode {
  return {
    type: NODE_TYPES.HEADING,
    id,
    attrs: { level: 1 },
    children: [t(text)],
  };
}

/** 段落 */
function paragraph(id: string, children: BookNode[]): BookNode {
  return { type: NODE_TYPES.PARAGRAPH, id, children };
}

/** 双行小注（朱注） */
function doubleNote(id: string, children: BookNode[]): BookNode {
  return { type: CLASSICAL_NODE_TYPES.DOUBLE_NOTE, id, children };
}

/** 校勘记 */
function collationNote(id: string, children: BookNode[]): BookNode {
  return { type: CLASSICAL_NODE_TYPES.COLLATION_NOTE, id, children };
}

/* ---------------- 文档构造 ---------------- */

/** 《论语·学而》（含为政）阅读样例 */
export const lunyuDocument: BookDocument = (() => {
  const doc = createEmptyDocument({
    title: '论语',
    subtitle: '学而第一 · 为政第二',
    language: 'zh-Hans',
    contributors: [{ name: '孔子及弟子', dynasty: '春秋', role: '述' }],
    volumeCount: 1,
  });

  doc.root.children = [
    {
      type: NODE_TYPES.VOLUME,
      id: 'vol-shang',
      attrs: { title: '上论' },
      children: [
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-xue-er',
          attrs: { title: '学而第一' },
          children: [
            heading('h-xue-er', '学而第一'),
            paragraph('p-xue-1', [
              t('子曰：「学而时习之，不亦'),
              t('说', ruby('yuè')),
              t('乎？有朋自远方来，不亦乐乎？人不知而不愠，不亦君子乎？」'),
            ]),
            doubleNote('note-xue-1', [
              t(
                '朱子曰：「说，悦同。学之为言效也。人性皆善，而觉有先后，' +
                  '后觉者必效先觉之所为，乃可以明善而复其初也。」',
              ),
            ]),
            paragraph('p-xue-2', [
              t('有子曰：「其为人也孝'),
              t('弟', ruby('tì')),
              t('，而好犯上者，鲜矣；不好犯上，而好作乱者，未之有也。」'),
            ]),
            doubleNote('note-xue-2', [
              t('注：「弟、好，皆去声。善事父母为孝，善事兄长为弟。」'),
            ]),
            paragraph('p-xue-3', [
              t(
                '巧言令色',
                classicalMark(CLASSICAL_MARK_TYPES.CIRCLE_EMPHASIS, { style: 'circle' }),
              ),
              t('，鲜矣仁。'),
            ]),
            collationNote('colla-xue-1', [
              t('校勘记：「案：'),
              t('说', classicalMark(CLASSICAL_MARK_TYPES.VARIANT, { original: '悦' })),
              t('，《唐石经》作「悦」；'),
              t('弟', classicalMark(CLASSICAL_MARK_TYPES.VARIANT, { original: '悌' })),
              t('，《经典释文》本作「悌」。」'),
            ]),
          ],
        },
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-wei-zheng',
          attrs: { title: '为政第二' },
          children: [
            heading('h-wei-zheng', '为政第二'),
            paragraph('p-zheng-1', [
              t('子曰：「为政以德，譬如'),
              t('北辰', classicalMark(CLASSICAL_MARK_TYPES.PROPER_NAME)),
              t('，居其所而众星'),
              t('共', classicalMark(CLASSICAL_MARK_TYPES.VARIANT, { original: '拱' })),
              t('之。」'),
            ]),
            doubleNote('note-zheng-1', [
              t(
                '朱子曰：「政之为言正也，所以正人之不正也。德之为言得也，' +
                  '得于心而不失之谓也。北辰，北极，天之枢也。」',
              ),
            ]),
            paragraph('p-zheng-2', [
              t('子曰：「'),
              t('诗三百', classicalMark(CLASSICAL_MARK_TYPES.BOOK_TITLE)),
              t('，一言以蔽之，曰：『思无邪』。」'),
            ]),
            collationNote('colla-zheng-1', [
              t(
                '校勘记：「案：『共』，《经典释文》云：『郑本作「拱」。』」',
              ),
            ]),
          ],
        },
      ],
    },
  ];

  return doc;
})();
