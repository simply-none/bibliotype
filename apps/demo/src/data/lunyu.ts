/**
 * 《论语集解》样册数据（IR）
 *
 * 按《电子版书籍必备内容要素清单（含古籍）》组织，覆盖：
 * - 元数据：题名 / 责任者 / 出版 / 版本 / 标识符 / 四部分类 + extra 古籍著录；
 * - 结构骨架：封面 → 书名页 → 版权页 → 目录 → 牌记 → 整理说明 → 凡例 →
 *   正文（卷端题署 → 章 → 卷末题记）→ 附录 → 校点后记 → 封底；
 * - 正文要素：双行小注 / 脚注（注码+注线）/ 眉批 / 校勘记（出校符号）/
 *   异体字载体 / ruby 注音 / 专名号 / 书名号 / 圈点 / 行内校勘符号；
 * - 版式角色（data-role）：见 layout 书册样式表（封面/书名页/版权页/目录/卷端/封底）。
 *
 * 约定：正文块内不直嵌块级元素；行内载体（异体字、校勘符号）允许与文本混排，
 * 叶块判定见 reader.extractBlocks（混排文本的容器整体成块）。
 * 文中校语、批语为演示拟作，非学术定本。
 */
import {
  MARK_TYPES,
  NODE_TYPES,
  createEmptyDocument,
  type Attrs,
  type BookDocument,
  type BookMark,
  type BookNode,
} from '@bibliotype/core';
import { CLASSICAL_MARK_TYPES, CLASSICAL_NODE_TYPES } from '@bibliotype/classical';

/* ---------------- 构造工具：文本与标记 ---------------- */

/** 文本叶子（可携带行内标记） */
function t(text: string, ...marks: BookMark[]): BookNode {
  return {
    type: NODE_TYPES.TEXT,
    text,
    ...(marks.length > 0 ? { marks } : {}),
  };
}

/** 注音标记（ruby，attrs.text 携带注文） */
function ruby(reading: string): BookMark {
  return { type: MARK_TYPES.RUBY, attrs: { text: reading } };
}

/** 古籍行内标记（proper-name / book-title / circle-emphasis / variant / taboo） */
function classicalMark(type: string, attrs?: Record<string, string>): BookMark {
  return { type, ...(attrs !== undefined ? { attrs } : {}) };
}

/** 注文引用标记（注码锚点，attrs.noteId 指向注文节点） */
function noteRef(noteId: string): BookMark {
  return classicalMark(CLASSICAL_MARK_TYPES.NOTE_REF, { noteId });
}

/* ---------------- 构造工具：块级节点 ---------------- */

/** 标题（默认 level 1） */
function heading(id: string, text: string, attrs?: Attrs): BookNode {
  return {
    type: NODE_TYPES.HEADING,
    id,
    attrs: { level: 1, ...attrs },
    children: [t(text)],
  };
}

/** 段落 */
function paragraph(id: string, children: BookNode[], attrs?: Attrs): BookNode {
  return {
    type: NODE_TYPES.PARAGRAPH,
    id,
    ...(attrs !== undefined ? { attrs } : {}),
    children,
  };
}

/** 版式角色段落（data-role 由书册样式表定向） */
function roleParagraph(id: string, role: string, text: string): BookNode {
  return paragraph(id, [t(text)], { role });
}

/**
 * 双行夹注（朱注）——行内容器（v2 批 1 行内化）：随文落在段落内，
 * 由 paragraph 的行内 children 引用；勿再直接挂块位。
 */
function doubleNote(id: string, text: string): BookNode {
  return { type: CLASSICAL_NODE_TYPES.DOUBLE_NOTE, id, children: [t(text)] };
}

/** 脚注（页下注） */
function footnote(id: string, text: string): BookNode {
  return { type: NODE_TYPES.FOOTNOTE, id, children: [t(text)] };
}

/** 眉批 */
function headNote(id: string, text: string, by?: string): BookNode {
  return {
    type: CLASSICAL_NODE_TYPES.HEAD_NOTE,
    id,
    ...(by !== undefined ? { attrs: { by } } : {}),
    children: [t(text)],
  };
}

/** 校勘记 */
function collationNote(id: string, children: BookNode[]): BookNode {
  return { type: CLASSICAL_NODE_TYPES.COLLATION_NOTE, id, children };
}

/** 校勘符号（行内空元素，符号经 CSS ::after attr(data-symbol) 呈现） */
function collationSymbol(symbol: string): BookNode {
  return { type: CLASSICAL_NODE_TYPES.COLLATION_MARK, attrs: { symbol } };
}

/** 异体字行内载体（保留原字形，attrs.standard 携规范字形） */
function variantChar(
  id: string,
  char: string,
  standard: string,
  ...marks: BookMark[]
): BookNode {
  return {
    type: CLASSICAL_NODE_TYPES.VARIANT_CHAR,
    id,
    attrs: { standard },
    children: [t(char, ...marks)],
  };
}

/** 牌记（刊刻信息，古籍条件必备） */
function imprint(id: string, text: string): BookNode {
  return { type: CLASSICAL_NODE_TYPES.IMPRINT, id, children: [t(text)] };
}

/** 卷末题记 */
function colophon(id: string, text: string): BookNode {
  return { type: CLASSICAL_NODE_TYPES.COLOPHON, id, children: [t(text)] };
}

/* ---------------- 结构页 ---------------- */

/** 封面：书名 / 副题 / 署者 / 出版者（版式角色经书册样式表定向） */
function coverPage(): BookNode {
  return {
    type: NODE_TYPES.COVER,
    id: 'cover',
    children: [
      heading('cover-title', '论语集解', { role: 'cover-title' }),
      roleParagraph('cover-subtitle', 'cover-subtitle', '上论　学而第一 · 为政第二'),
      roleParagraph('cover-creator', 'cover-creator', '魏　何晏　集解　　宋　朱熹　集注'),
      roleParagraph('cover-publisher', 'cover-publisher', 'bibliotype 整理本'),
    ],
  };
}

/** 书名页（扉页）：完整题名 + 署者 + 出版者 */
function titlePage(): BookNode {
  return {
    type: NODE_TYPES.TITLE_PAGE,
    id: 'title-page',
    children: [
      roleParagraph('tp-title', 'title-page-title', '论语集解'),
      roleParagraph('tp-subtitle', 'title-page-subtitle', '二卷（上论、下论）'),
      roleParagraph('tp-creator', 'title-page-creator', '魏何晏集解　宋朱熹集注　今据殿本校点'),
      roleParagraph('tp-publisher', 'title-page-publisher', 'bibliotype 整理本'),
    ],
  };
}

/** 版权页：版权记录（CY/T 112 要素）+ 古籍著录（WH/T 66 要素） */
function copyrightPage(): BookNode {
  return {
    type: NODE_TYPES.COPYRIGHT_PAGE,
    id: 'copyright-page',
    children: [
      roleParagraph('cp-title', 'copyright-title', '版权记录'),
      roleParagraph('cp-line-1', 'copyright-line', '书名：论语集解（上论）'),
      roleParagraph(
        'cp-line-2',
        'copyright-line',
        '责任者：孔子及弟子述　何晏集解　朱熹集注　bibliotype 整理组校点',
      ),
      roleParagraph(
        'cp-line-3',
        'copyright-line',
        '出版：bibliotype 演示书坊　2026 年 10 月第 1 版　版本号 v1.0',
      ),
      roleParagraph(
        'cp-line-4',
        'copyright-line',
        '标识：ISBN 978-7-000-00000-0（演示）　URN urn:bibliotype:demo:lunyu',
      ),
      roleParagraph('cp-line-5', 'copyright-line', '分类：经部 · 四书类 · 论语'),
      roleParagraph(
        'cp-line-6',
        'copyright-line',
        '古籍著录：清乾隆五十三年武英殿刻本（影印整理）；线装一册；半叶九行，行二十字，小字双行。',
      ),
      roleParagraph('cp-line-7', 'copyright-line', '版权所有 · 侵权必究'),
    ],
  };
}

/** 目录页（书内目录；侧栏导航由 reader 目录自动生成） */
function tocPage(): BookNode {
  return {
    type: NODE_TYPES.TOC,
    id: 'toc-page',
    children: [
      heading('toc-title', '目录', { role: 'toc-title' }),
      roleParagraph('toc-entry-shang', 'toc-entry', '上论'),
      roleParagraph('toc-entry-xue', 'toc-subentry', '学而第一'),
      roleParagraph('toc-entry-zheng', 'toc-subentry', '为政第二'),
    ],
  };
}

/** 封底：版权简记与条码区（演示） */
function backCover(): BookNode {
  return {
    type: NODE_TYPES.BACK_COVER,
    id: 'back-cover',
    children: [
      roleParagraph('bc-1', 'back-cover-line', '论语集解 · 上论'),
      roleParagraph('bc-2', 'back-cover-line', '述者 孔子及弟子　集解 何晏　集注 朱熹'),
      roleParagraph('bc-3', 'back-cover-line', 'bibliotype 整理本 · 电子版 v1.0'),
      roleParagraph('bc-4', 'back-cover-line', 'ISBN 978-7-000-00000-0（演示）'),
    ],
  };
}

/* ---------------- 文档构造 ---------------- */

/** 《论语集解》上论样册（结构完整、要素齐备的演示书） */
export const lunyuDocument: BookDocument = (() => {
  const doc = createEmptyDocument({
    title: '论语集解',
    subtitle: '上论：学而第一 · 为政第二',
    language: 'zh-Hans',
    contributors: [
      { name: '孔子及弟子', dynasty: '春秋', role: '述' },
      { name: '何晏', dynasty: '魏', role: '集解' },
      { name: '朱熹', dynasty: '宋', role: '集注' },
      { name: 'bibliotype 整理组', role: '校点' },
    ],
    volumeCount: 1,
    identifiers: [
      { scheme: 'isbn', value: '978-7-000-00000-0' },
      { scheme: 'other', value: 'urn:bibliotype:demo:lunyu' },
    ],
    publication: {
      publisher: 'bibliotype 演示书坊',
      year: '2026',
      place: '线上',
    },
    edition: {
      name: '武英殿本影印整理本',
      era: '清乾隆五十三年',
      publisher: '武英殿',
      kind: 'base',
    },
    classification: '经部 · 四书类 · 论语',
    extra: {
      versionType: '刻本（武英殿本）',
      editionAreas: '据清乾隆五十三年武英殿刻本影印整理',
      binding: '线装（一册，不分函）',
      linesPerHalfLeaf: '半叶九行，行二十字，小字双行',
      borderFrame: '四周双边',
      pageCenter: '白口，单黑鱼尾；鱼尾上题书名，下记页码',
      collection: 'bibliotype 演示藏',
      shelfMark: 'BT-DEMO-LY-01',
      revision: 'v1.0（2026-10）',
    },
  });

  doc.root.children = [
    coverPage(),
    titlePage(),
    copyrightPage(),
    tocPage(),
    imprint(
      'imprint',
      '牌记：武英殿刻书牌——乾隆五十三年（一七八八）重刊，板藏武英殿。',
    ),
    {
      type: NODE_TYPES.PREFACE,
      id: 'preface',
      children: [
        heading('pre-title', '整理说明'),
        paragraph('pre-p1', [
          t(
            '本书是 bibliotype 排版引擎的古籍样册，取《论语》上论二篇以示例。' +
              '底本、行款、注文与校勘格式均依整理本通例编排，用于验证直排、注疏、校勘、批点等古籍版式要素。',
          ),
        ]),
        paragraph('pre-p2', [
          t(
            '全书标点用新式标点；音释随文以注音（ruby）标注；异文出校于篇末，出校符号以○△别之。' +
              '具体体例，见《凡例》。',
          ),
        ]),
      ],
    },
    {
      type: NODE_TYPES.SECTION,
      id: 'fanli',
      attrs: { title: '凡例' },
      children: [
        heading('fan-title', '凡例'),
        paragraph('fa-p1', [
          t(
            '一、本书以清乾隆五十三年武英殿刻本为底本，参校《唐石经》本、《经典释文》所引诸本及朱熹《集注》本。',
          ),
        ]),
        paragraph('fa-p2', [
          t('二、底本与校本之异文，随篇出校，缀于篇末；出校符号以○△别之。'),
        ]),
        paragraph('fa-p3', [
          t(
            '三、注文依何晏《集解》、朱熹《集注》之次；音释随文以注音标注，异体、通假之字随文出校。',
          ),
        ]),
        paragraph('fa-p4', [
          t(
            '四、避讳缺笔之字、阙文无考之字，从底本著录，另注说明；集中展示于校勘记中。',
          ),
        ]),
      ],
    },
    {
      type: NODE_TYPES.VOLUME,
      id: 'vol-shang',
      attrs: { title: '上论' },
      children: [
        heading('vol-head-shang', '论语卷第一　上论', { role: 'volume-title' }),
        roleParagraph(
          'vol-credits-shang',
          'volume-creator',
          '魏何晏集解　宋朱熹集注　今据殿本校点',
        ),
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-xue-er',
          attrs: { title: '学而第一' },
          children: [
            heading('h-xue-er', '学而第一'),
            paragraph('p-xue-1', [
              t('子曰：「学而时习之，不亦'),
              t('说', ruby('yuè')),
              t('乎？有朋自远方来，不亦乐乎？人不知而不'),
              t('愠', ruby('yùn')),
              t('①', noteRef('fn-xue-1')),
              t('，不亦君子乎？」'),
              doubleNote(
              'note-xue-1',
              '朱子曰：「说，悦同。学之为言效也。人性皆善，而觉有先后，后觉者必效先觉之所为，' +
              '乃可以明善而复其初也。习，鸟数飞也；学之不已，如鸟数飞也。愠，纡问反，怒也。' +
              '君子，成德之名。此三者皆学之本也。」',
              ),
            ]),
            footnote(
              'fn-xue-1',
              '注① 愠，怒也。《集解》引马融曰：「愠，怒也。凡人有所不知，君子不怒。」',
            ),
            headNote(
              'hn-xue-1',
              '此章总言为学之要，三层递进：时习以自修，远朋以共学，不愠以成德，实为全书开篇之纲。',
              '整理者拟批',
            ),
            paragraph('p-xue-2', [
              t('有子曰：「其为人也孝'),
              variantChar('vc-xue-di', '弟', '悌', ruby('tì')),
              t(
                '，而好犯上者，鲜矣；不好犯上，而好作乱者，未之有也。君子务本，本立而道生。孝弟也者，其为仁之本与！」',
              ),
              doubleNote(
              'note-xue-2',
              '注：「弟、好，皆去声。善事父母为孝，善事兄长为弟。本，犹根也。」',
              ),
            ]),
            paragraph('p-xue-3', [
              t(
                '巧言令色',
                classicalMark(CLASSICAL_MARK_TYPES.CIRCLE_EMPHASIS, { style: 'circle' }),
              ),
              t('，鲜矣仁。'),
            ]),
            collationNote('colla-xue-1', [
              t('校勘记：'),
              collationSymbol('○'),
              t('「说」，《唐石经》作「悦」；'),
              collationSymbol('△'),
              t('「弟」，《经典释文》本作「悌」；又「人不知而不愠」，皇侃本「愠」下有「也」字。'),
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
              doubleNote(
              'note-zheng-1',
              '朱子曰：「政之为言正也，所以正人之不正也。德之为言得也，得于心而不失之谓也。' +
              '北辰，北极，天之枢也。居其所，不动也。共，向也。言众星四面旋绕而归向之也。」',
              ),
            ]),
            paragraph('p-zheng-2', [
              t('子曰：「'),
              t('诗三百', classicalMark(CLASSICAL_MARK_TYPES.BOOK_TITLE)),
              t('，一言以蔽之，曰：『思无邪』。」'),
              doubleNote(
              'note-zheng-2',
              '朱子曰：「凡《诗》之言，善者可以感发人之善心，恶者可以惩创人之逸志，' +
              '其用归于使人得其情性之正而已。然其言微婉，且或各因一事而发，求其直指全体，则未有若此之明且尽者。」',
              ),
            ]),
            paragraph('p-zheng-3', [
              t('子曰：「'),
              t('道'),
              t('②', noteRef('fn-zheng-1')),
              t(
                '之以政，齐之以刑，民免而无耻；道之以德，齐之以礼，有耻且格。」',
              ),
            ]),
            footnote(
              'fn-zheng-1',
              '注② 道，去声，通「导」。齐，所以一之也；格，至也，言至于善也。',
            ),
            collationNote('colla-zheng-1', [
              t('校勘记：'),
              collationSymbol('○'),
              t('「共」，《经典释文》云：「郑本作『拱』。」'),
              collationSymbol('△'),
              t('「道之以政」二「道」字，皇本俱作「导」。'),
            ]),
          ],
        },
        colophon(
          'colophon-shang',
          '卷末题记：右《论语》上论二篇讫。底本板心鱼尾上题「论语卷第一」，' +
            '版框四周双边，半叶九行、行二十字，小字双行。',
        ),
      ],
    },
    {
      type: NODE_TYPES.APPENDIX,
      id: 'appendix',
      children: [
        heading('app-title', '附录：《论语》版本流传简记'),
        paragraph('app-p1', [
          t(
            '西汉时，《论语》有《齐论》二十二篇、《鲁论》二十篇、《古论》二十一篇三家。' +
              '张禹以《鲁论》为本，兼采《齐论》，号为《张侯论》。东汉郑玄就《张侯论》为之注，' +
              '今本篇章次序盖定于此。',
          ),
        ]),
        paragraph('app-p2', [
          t(
            '魏何晏集孔安国、包咸、周氏、马融、郑玄诸家之说，成《论语集解》，后世注疏皆本焉。' +
              '宋朱熹辑《论语集注》，与《大学》《中庸》《孟子》合为「四书」，其学遂广。',
          ),
        ]),
      ],
    },
    {
      type: NODE_TYPES.POSTSCRIPT,
      id: 'postscript',
      children: [
        heading('ps-title', '校点后记'),
        paragraph('ps-p1', [
          t(
            '本电子册为 bibliotype 排版引擎演示数据：正文、注文与校勘文字均取通行文本，' +
              '版式与标注依古籍整理体例设计，非学术定本，仅供演示参考。',
          ),
        ]),
        paragraph('ps-p2', [
          t(
            '标点从简，异体、通假随文出校；避讳字、缺字之处理体例另见《凡例》。' +
              '校勘符号、批语位置及行款著录均用于验证排版引擎对古籍版式的呈现能力。',
          ),
        ]),
      ],
    },
    backCover(),
  ];

  return doc;
})();
