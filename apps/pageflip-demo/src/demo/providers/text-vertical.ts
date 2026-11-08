/**
 * 竖排直排书页提供者：程序绘制古籍样张（RTL 右起行款）。
 *
 * 版框 + 界行 + 鱼尾版心 + 书口页码，文字逐列自右向左、自上而下；
 * 标点顺时针转 90° 贴字；分页为纵横比驱动的字符网格（与像素尺寸无关）。
 * 行款 rtl：书脊在屏幕右侧，翻页自左向右揭页。
 */
import type { PageProvider } from '@bibliotype/page-flip';

const TITLE = '論語';
const CHAPTER = '學而第一';

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
  '子贡曰：「贫而无谄，富而无骄，何如？」子曰：「可也。未若贫而乐，富而好礼者也。」',
  '子曰：「不患人之不己知，患不知人也。」',
  '子曰：「为政以德，譬如北辰，居其所而众星共之。」',
  '子曰：「《诗》三百，一言以蔽之，曰：思无邪。」',
  '子曰：「吾十有五而志于学，三十而立，四十而不惑，五十而知天命，六十而耳顺，七十而从心所欲，不逾矩。」',
  '子曰：「温故而知新，可以为师矣。」',
  '子曰：「学而不思则罔，思而不学则殆。」',
];

const HEAD_FORBIDDEN = '，。！？；：、）」』…—％';
const ROTATED_PUNCT = '，。、；：？！「」《》';
const CN_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function cnPageNumber(n: number): string {
  if (n <= 10) {
    return CN_DIGITS[n] ?? String(n);
  }
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return (tens > 1 ? CN_DIGITS[tens] : '') + '十' + (ones === 0 ? '' : CN_DIGITS[ones]);
}

/** 版面比例（相对页高 H）。 */
const FS = 0.034; // 字号
const CHAR_ADV = 1.22; // 字距（字号倍数，竖向）
const COL_ADV = 1.42; // 列距（字号倍数，横向）
const MARGIN = 0.075; // 版框内缩

interface TextGrid {
  charsPerCol: number;
  colsPerPage: number;
  pages: string[][][]; // 页 → 列（自右向左）→ 字符
}

/** 拆段 → 字符流 → 逐列填充（列首禁则：禁则标点挤入前列尾）。 */
function buildGrid(aspect: number): TextGrid {
  // 字距/列距为字号倍数，换算为页高比例需乘 FS（与像素尺寸无关）
  const charsPerCol = Math.max(8, Math.floor((1 - 2 * MARGIN) / (FS * CHAR_ADV)));
  const innerW = aspect - 2 * MARGIN;
  const colsPerPage = Math.max(4, Math.floor(innerW / (FS * COL_ADV)));
  const pages: string[][][] = []; // 占位结构：页 → 列 → 字
  const pageCols: string[][] = [];
  let col: string[] = [];
  const flushCol = (): void => {
    if (col.length > 0) {
      pageCols.push(col);
      col = [];
    }
  };
  const flushPage = (): void => {
    flushCol();
    if (pageCols.length > 0) {
      pages.push(pageCols.slice());
      pageCols.length = 0;
    }
  };
  for (const paragraph of PARAGRAPHS) {
    for (const ch of paragraph) {
      if (col.length >= charsPerCol) {
        if (HEAD_FORBIDDEN.includes(ch)) {
          col.push(ch); // 禁则：挤入前列尾
          continue;
        }
        flushCol();
        if (pageCols.length >= colsPerPage) {
          flushPage();
        }
      }
      col.push(ch);
    }
  }
  flushPage();
  return { charsPerCol, colsPerPage, pages };
}

export function createVerticalTextProvider(): PageProvider {
  const aspect = 0.68;
  const grid = buildGrid(aspect);
  const provider: PageProvider = {
    pageCount: grid.pages.length + 1,
    aspect,
    orientation: 'rtl',
    ready: Promise.resolve(),
    renderPage(ctx, pageIndex, w, h) {
      drawPaper(ctx, w, h);
      if (pageIndex === 0) {
        drawCover(ctx, w, h);
        return;
      }
      const page = grid.pages[Math.min(pageIndex - 1, grid.pages.length - 1)];
      drawFrame(ctx, w, h);
      drawColumns(ctx, page, w, h);
      drawFishTail(ctx, w, h, pageIndex);
      drawMarginNumber(ctx, w, h, pageIndex);
    },
  };
  return provider;
}

function drawPaper(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#f6efe0');
  grad.addColorStop(1, '#efe5cf');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawCover(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#2f2a22';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(214, 190, 138, 0.85)';
  ctx.lineWidth = Math.max(2, w * 0.012);
  ctx.strokeRect(w * 0.08, h * 0.06, w * 0.84, h * 0.88);
  // 直排书名（右侧起）
  const fs = Math.round(h * 0.1);
  ctx.fillStyle = '#e6d5a8';
  ctx.font = `600 ${fs}px "Noto Serif SC", "SimSun", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = [...TITLE];
  chars.forEach((ch, i) => {
    ctx.fillText(ch, w * 0.72, h * 0.2 + i * fs * 1.25);
  });
  ctx.font = `${Math.round(h * 0.028)}px "Noto Serif SC", "SimSun", serif`;
  ctx.fillStyle = 'rgba(230, 213, 168, 0.75)';
  ['仿真', '翻页', '样张'].forEach((word, i) => {
    ctx.fillText(word, w * 0.34, h * 0.22 + i * h * 0.05);
  });
  // 左下角印章（非对称元素：翻页背面镜像时左右反转，用于辨识"这是背面"）
  const seal = w * 0.16;
  ctx.fillStyle = 'rgba(170, 58, 40, 0.88)';
  ctx.fillRect(w * 0.16, h * 0.74, seal, seal);
  ctx.fillStyle = '#f3e2c2';
  ctx.font = `600 ${Math.round(seal * 0.36)}px "Noto Serif SC", "SimSun", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('仿', w * 0.16 + seal / 2, h * 0.74 + seal * 0.3);
  ctx.fillText('真', w * 0.16 + seal / 2, h * 0.74 + seal * 0.72);
}

/** 双线版框 + 界行。 */
function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const m = h * MARGIN;
  const innerW = w - 2 * m;
  const innerH = h - 2 * m;
  ctx.strokeStyle = '#7a6748';
  ctx.lineWidth = Math.max(1.5, h * 0.004);
  ctx.strokeRect(m, m, innerW, innerH);
  ctx.lineWidth = 1;
  ctx.strokeRect(m + h * 0.008, m + h * 0.008, innerW - h * 0.016, innerH - h * 0.016);
  // 界行（列界）：自右向左
  const fs = h * FS;
  const adv = fs * COL_ADV;
  ctx.strokeStyle = 'rgba(122, 103, 72, 0.4)';
  const colCount = Math.floor((w - 2 * m) / adv);
  for (let c = 1; c < colCount; c++) {
    const x = w - m - c * adv;
    ctx.beginPath();
    ctx.moveTo(x, m);
    ctx.lineTo(x, h - m);
    ctx.stroke();
  }
}

/** 逐列绘制字符；标点顺时针转 90°。 */
function drawColumns(ctx: CanvasRenderingContext2D, page: string[][], w: number, h: number): void {
  const fs = h * FS;
  const m = h * MARGIN;
  const startX = w - m - fs * 0.7;
  ctx.fillStyle = '#33291c';
  ctx.font = `${fs}px "Noto Serif SC", "SimSun", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  page.forEach((column, colIndex) => {
    const x = startX - colIndex * fs * COL_ADV;
    [...column].forEach((ch, charIndex) => {
      const y = m + fs * 0.75 + charIndex * fs * CHAR_ADV;
      if (ROTATED_PUNCT.includes(ch)) {
        ctx.save();
        ctx.translate(x + fs * 0.16, y - fs * 0.1);
        ctx.rotate(Math.PI / 2);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      } else {
        ctx.fillText(ch, x, y);
      }
    });
  });
}

/** 版心鱼尾 + 章名 + 页码（下匡中）。 */
function drawFishTail(ctx: CanvasRenderingContext2D, w: number, h: number, pageIndex: number): void {
  const m = h * MARGIN;
  const fs = h * FS;
  const cx = w / 2;
  const baseY = h - m;
  // 鱼尾：两个相对弧构成的燕尾形
  ctx.fillStyle = 'rgba(122, 103, 72, 0.75)';
  ctx.beginPath();
  ctx.moveTo(cx, baseY - h * 0.028);
  ctx.quadraticCurveTo(cx - fs * 0.5, baseY - h * 0.01, cx - fs * 0.7, baseY);
  ctx.lineTo(cx + fs * 0.7, baseY);
  ctx.quadraticCurveTo(cx + fs * 0.5, baseY - h * 0.01, cx, baseY - h * 0.028);
  ctx.fill();
  // 版心文字：章名 · 页码
  ctx.fillStyle = '#7a6748';
  ctx.font = `${fs * 0.78}px "Noto Serif SC", "SimSun", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(CHAPTER, cx, baseY + fs * 0.75);
  ctx.fillText('· ' + cnPageNumber(pageIndex + 1) + ' ·', cx, baseY + fs * 1.75);
}

/** 书口页码（左匡外侧，竖排小字）。 */
function drawMarginNumber(ctx: CanvasRenderingContext2D, w: number, h: number, pageIndex: number): void {
  const fs = h * 0.022;
  ctx.fillStyle = 'rgba(122, 103, 72, 0.65)';
  ctx.font = `${fs}px "Noto Serif SC", "SimSun", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = [...('第' + cnPageNumber(pageIndex + 1) + '葉')];
  chars.forEach((ch, i) => {
    ctx.fillText(ch, h * 0.032, h * 0.16 + i * fs * 1.25);
  });
}
