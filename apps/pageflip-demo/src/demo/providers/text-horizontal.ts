/**
 * 横排书页提供者：程序绘制《论语》样张（封面 + 正文页）。
 *
 * 分页按「纵横比驱动的字符网格」计算（字号、行高均为页面高度的比例），
 * 与实际画布尺寸无关——pageCount 在创建时即确定，任意分辨率下分页一致。
 * 贪心断行 + 简易避头尾（行首禁则标点挤入行尾），页码用中文数字。
 */
import type { PageProvider } from '@bibliotype/page-flip';

const TITLE = '论语';
const CHAPTER = '学而第一';
/** 版心宽高比（版心宽 / 页面高）。 */
const TEXT_RATIO = 0.76;
const FONT_RATIO = 0.036;
const LINE_HEIGHT = 1.85;
const START_Y_RATIO = 0.155;

/** 学而篇 + 为政篇节选（每段一章）。 */
const PARAGRAPHS: string[] = [
  '子曰：「学而时习之，不亦说乎？有朋自远方来，不亦乐乎？人不知而不愠，不亦君子乎？」',
  '有子曰：「其为人也孝弟，而好犯上者，鲜矣；不好犯上，而好作乱者，未之有也。君子务本，本立而道生。孝弟也者，其为仁之本与！」',
  '子曰：「巧言令色，鲜矣仁。」',
  '曾子曰：「吾日三省吾身：为人谋而不忠乎？与朋友交而不信乎？传不习乎？」',
  '子曰：「道千乘之国，敬事而信，节用而爱人，使民以时。」',
  '子曰：「弟子入则孝，出则弟，谨而信，泛爱众，而亲仁。行有余力，则以学文。」',
  '子夏曰：「贤贤易色；事父母，能竭其力；事君，能致其身；与朋友交，言而有信。虽曰未学，吾必谓之学矣。」',
  '子曰：「君子不重则不威，学则不固。主忠信，无友不如己者。过则勿惮改。」',
  '曾子曰：「慎终追远，民德归厚矣。」',
  '子曰：「君子食无求饱，居无求安，敏于事而慎于言，就有道而正焉，可谓好学也已。」',
  '子贡曰：「贫而无谄，富而无骄，何如？」子曰：「可也。未若贫而乐，富而好礼者也。」子贡曰：「《诗》云：如切如磋，如琢如磨，其斯之谓与？」子曰：「赐也，始可与言《诗》已矣，告诸往而知来者。」',
  '子曰：「不患人之不己知，患不知人也。」',
  '子曰：「为政以德，譬如北辰，居其所而众星共之。」',
  '子曰：「《诗》三百，一言以蔽之，曰：思无邪。」',
  '子曰：「吾十有五而志于学，三十而立，四十而不惑，五十而知天命，六十而耳顺，七十而从心所欲，不逾矩。」',
  '子曰：「温故而知新，可以为师矣。」',
  '子曰：「学而不思则罔，思而不学则殆。」',
  '子曰：「由，诲女知之乎！知之为知之，不知为不知，是知也。」',
];

const HEAD_FORBIDDEN = '，。！？；：、）」』…—％';

const CN_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 中文数字页码。 */
function cnPageNumber(n: number): string {
  if (n <= 10) {
    return CN_DIGITS[n] ?? String(n);
  }
  if (n < 20) {
    return '十' + (n % 10 === 0 ? '' : CN_DIGITS[n % 10]);
  }
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return CN_DIGITS[tens] + '十' + (ones === 0 ? '' : CN_DIGITS[ones]);
}

interface LaidOutPage {
  lines: string[];
  /** 每行行首是否缩进（段落首行）。 */
  indents: boolean[];
}

interface TextGrid {
  charsPerLine: number;
  linesPerPage: number;
  pages: LaidOutPage[];
}

/** 逐字贪心断行（行首禁则：禁则标点挤入行尾）。 */
function breakLines(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (line.length >= maxChars) {
      if (HEAD_FORBIDDEN.includes(ch)) {
        line += ch;
        lines.push(line);
        line = '';
        continue;
      }
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

/** 构建字符网格分页（纵横比固定 → 与画布像素尺寸无关）。 */
function buildGrid(aspect: number): TextGrid {
  // charsPerLine = 版心宽 / 字号 = TEXT_RATIO·aspect·H / FONT_RATIO·H —— 只依赖 aspect
  const charsPerLine = Math.max(8, Math.floor((TEXT_RATIO * aspect) / FONT_RATIO));
  const linesPerPage = Math.max(6, Math.floor((1 - START_Y_RATIO - 0.09) / (FONT_RATIO * LINE_HEIGHT)));
  const pages: LaidOutPage[] = [];
  let lines: string[] = [];
  let indents: boolean[] = [];
  const flush = (): void => {
    if (lines.length > 0) {
      pages.push({ lines, indents });
      lines = [];
      indents = [];
    }
  };
  for (const paragraph of PARAGRAPHS) {
    const paraLines = breakLines(paragraph, charsPerLine);
    paraLines.forEach((line, index) => {
      if (lines.length >= linesPerPage) {
        flush();
      }
      lines.push(line);
      indents.push(index === 0);
    });
  }
  flush();
  return { charsPerLine, linesPerPage, pages };
}

export function createHorizontalTextProvider(): PageProvider {
  const aspect = 0.68;
  const grid = buildGrid(aspect);
  const provider: PageProvider = {
    pageCount: grid.pages.length + 1, // 首页为封面
    aspect,
    orientation: 'ltr',
    ready: Promise.resolve(),
    renderPage(ctx, pageIndex, w, h) {
      drawPaper(ctx, w, h);
      if (pageIndex === 0) {
        drawCover(ctx, w, h);
        return;
      }
      const page = grid.pages[Math.min(pageIndex - 1, grid.pages.length - 1)];
      drawHeader(ctx, w, h, pageIndex);
      drawBody(ctx, page, w, h);
      drawFooter(ctx, w, h, pageIndex);
    },
  };
  return provider;
}

function drawPaper(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#f8f3e7');
  grad.addColorStop(1, '#f1e9d6');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(160, 140, 100, 0.05)';
  ctx.lineWidth = 1;
  for (let y = 6; y < h; y += 9) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawCover(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#3d3428';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(216, 196, 150, 0.8)';
  ctx.lineWidth = Math.max(2, w * 0.012);
  ctx.strokeRect(w * 0.08, h * 0.06, w * 0.84, h * 0.88);
  ctx.fillStyle = '#e8d9b0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(h * 0.14)}px "Noto Serif SC", "SimSun", serif`;
  ctx.fillText(TITLE, w / 2, h * 0.42);
  ctx.font = `${Math.round(h * 0.034)}px "Noto Serif SC", "SimSun", serif`;
  ctx.fillText('仿真翻页 · 样张', w / 2, h * 0.58);
  ctx.fillText('LUN YU', w / 2, h * 0.65);
  // 右下角印章（非对称元素：翻页背面镜像时左右反转，用于辨识"这是背面"）
  drawSeal(ctx, w * 0.68, h * 0.76, w * 0.17);
}

/** 朱红印章（两字竖排）。 */
function drawSeal(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.fillStyle = 'rgba(170, 58, 40, 0.88)';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#f3e2c2';
  ctx.font = `600 ${Math.round(size * 0.36)}px "Noto Serif SC", "SimSun", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('仿', x + size / 2, y + size * 0.3);
  ctx.fillText('真', x + size / 2, y + size * 0.72);
}

function drawHeader(ctx: CanvasRenderingContext2D, w: number, h: number, pageIndex?: number): void {
  const fontSize = Math.round(h * 0.024);
  ctx.fillStyle = '#8a7a5c';
  ctx.font = `${fontSize}px "Noto Serif SC", "SimSun", serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(TITLE, w * 0.12, h * 0.075);
  ctx.textAlign = 'right';
  ctx.fillText(CHAPTER, w * 0.88, h * 0.075);
  ctx.strokeStyle = 'rgba(138, 122, 92, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w * 0.12, h * 0.1);
  ctx.lineTo(w * 0.88, h * 0.1);
  ctx.stroke();
  // 页面身份角标（右下大号页码章）：卷曲时区分正面 / 背面（镜像反读）/ 下层页
  if (pageIndex !== undefined && pageIndex > 0) {
    const badge = w * 0.13;
    ctx.fillStyle = 'rgba(58, 49, 38, 0.16)';
    ctx.beginPath();
    ctx.arc(w * 0.84, h * 0.9, badge / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(58, 49, 38, 0.55)';
    ctx.font = `600 ${Math.round(badge * 0.42)}px "Noto Serif SC", "SimSun", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(pageIndex + 1), w * 0.84, h * 0.9);
  }
}

function drawBody(ctx: CanvasRenderingContext2D, page: LaidOutPage, w: number, h: number): void {
  const fontSize = h * FONT_RATIO;
  const lineHeight = fontSize * LINE_HEIGHT;
  const left = w * 0.12;
  const top = h * START_Y_RATIO;
  ctx.fillStyle = '#3a3126';
  ctx.font = `${fontSize}px "Noto Serif SC", "SimSun", serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  page.lines.forEach((line, index) => {
    const indent = page.indents[index] ? fontSize * 2 : 0;
    ctx.fillText(line, left + indent, top + index * lineHeight);
  });
}

function drawFooter(ctx: CanvasRenderingContext2D, w: number, h: number, pageIndex: number): void {
  ctx.fillStyle = '#8a7a5c';
  ctx.font = `${Math.round(h * 0.024)}px "Noto Serif SC", "SimSun", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('— ' + cnPageNumber(pageIndex + 1) + ' —', w / 2, h * 0.94);
}
