/**
 * 挂历样张提供者（四向装订验证用）：横排 landscape 页面 + 简单月历版式。
 *
 * 页面内容为竖直屏幕向绘制（程序绘制），装订侧由 bindEdge 声明——
 * top = 上侧装订（页底边向上翻），bottom = 下侧装订（页顶边向下翻）。
 * 封面 + 月历页，程序绘制与分辨率无关（尺寸均按页面短边比例）。
 */
import type { BindEdge, PageProvider } from '@bibliotype/page-flip';

const MONTHS = ['十一月', '十二月', '一月', '二月', '三月', '四月'];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
/** 每月起始星期与天数（演示用固定值）。 */
const MONTH_GRID = [
  { start: 0, days: 30 },
  { start: 2, days: 31 },
  { start: 4, days: 31 },
  { start: 0, days: 28 },
  { start: 2, days: 31 },
  { start: 5, days: 30 },
];

export function createCalendarProvider(edge: BindEdge): PageProvider {
  const pageCount = 6;
  return {
    pageCount,
    aspect: 1.42,
    orientation: 'ltr',
    bindEdge: edge,
    ready: Promise.resolve(),
    renderPage(ctx, pageIndex, width, height) {
      const unit = Math.min(width, height);
      ctx.fillStyle = '#f3eee1';
      ctx.fillRect(0, 0, width, height);

      if (pageIndex === 0) {
        // 封面：大字「挂历」+ 装订侧标注
        ctx.fillStyle = '#3c3828';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = 'rgba(214, 190, 138, 0.7)';
        ctx.lineWidth = unit * 0.02;
        ctx.strokeRect(unit * 0.08, unit * 0.1, width - unit * 0.16, height - unit * 0.2);
        ctx.fillStyle = '#e6d9b8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${unit * 0.22}px serif`;
        ctx.fillText('仿真挂历', width / 2, height / 2 - unit * 0.08);
        ctx.font = `${unit * 0.075}px serif`;
        ctx.fillStyle = 'rgba(230, 217, 184, 0.75)';
        ctx.fillText(edge === 'top' ? '上侧装订 · 底边向上翻' : '下侧装订 · 顶边向下翻', width / 2, height / 2 + unit * 0.16);
        return;
      }

      // 月历页：顶部月份条 + 星期表头 + 日期网格
      const grid = MONTH_GRID[(pageIndex - 1) % MONTH_GRID.length];
      const month = MONTHS[(pageIndex - 1) % MONTHS.length];
      const margin = unit * 0.09;
      ctx.fillStyle = '#f3eee1';
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = '#43402e';
      ctx.fillRect(0, 0, width, unit * 0.14);
      ctx.fillStyle = '#f3eee1';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${unit * 0.085}px serif`;
      ctx.fillText(month, width / 2, unit * 0.07);

      const cols = WEEKDAYS.length;
      const cellW = (width - margin * 2) / cols;
      const gridTop = unit * 0.2;
      const rowH = unit * 0.115;
      ctx.font = `${unit * 0.055}px serif`;
      ctx.fillStyle = '#8a7c5a';
      WEEKDAYS.forEach((d, i) => {
        ctx.fillText(d, margin + cellW * (i + 0.5), gridTop);
      });

      ctx.fillStyle = '#3a3628';
      ctx.font = `${unit * 0.07}px serif`;
      for (let day = 1; day <= grid.days; day++) {
        const slot = grid.start + day - 1;
        const col = slot % cols;
        const row = Math.floor(slot / cols);
        ctx.fillText(String(day), margin + cellW * (col + 0.5), gridTop + rowH * (row + 1.4));
      }

      ctx.fillStyle = 'rgba(58, 54, 40, 0.55)';
      ctx.font = `${unit * 0.05}px serif`;
      ctx.fillText(`— ${pageIndex + 1} —`, width / 2, height - unit * 0.07);
    },
  };
}
