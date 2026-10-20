/**
 * 版心（书口）HTML 序列化
 *
 * 阅读视图、编辑分页画布与打印稿共用同一份产出，避免三端各写一份 DOM
 * （渲染与序列化同源）。只输出语义正确的窄带结构，视觉全部由
 * `book-css` 的 `.bt-page-gutter` 规则负责。
 *
 * 未启用版心（`facsimile.gutter` 缺省或字段全空）时返回空串，调用方无需
 * 额外判断即可拼入。
 */
import type { FacsimileOptions, PageGutterTexts } from '../facsimile.js';
import { escapeHtml } from './html-serializer.js';

/**
 * 序列化版心窄带
 *
 * @param texts 已经解析好的竖写文本（空串字段自动跳过）
 * @param facsimile 仿真版式（取位置 / 口子 / 鱼尾 / 字段顺序）
 * @returns 版心 HTML；未配置或所有字段为空时返回空串
 */
export function serializePageGutter(
  texts: PageGutterTexts,
  facsimile: FacsimileOptions | undefined,
): string {
  const gutter = facsimile?.gutter;
  if (gutter === undefined || gutter.fields.length === 0) return '';

  const fields = gutter.fields
    .map((field) => {
      const text = field === 'none' ? '' : texts[field].trim();
      if (text === '') return '';
      return `<div class="bt-page-gutter__field" data-field="${field}">${escapeHtml(text)}</div>`;
    })
    .filter((item) => item !== '');
  if (fields.length === 0) return '';

  const fishCount = gutter.fishTail === 'double' ? 2 : gutter.fishTail === 'single' ? 1 : 0;
  const fish = Array.from({ length: fishCount }, () => '<i class="bt-page-gutter__fish"></i>').join(
    '',
  );

  return (
    `<div class="bt-page-gutter" data-side="${gutter.side}" data-mouth="${gutter.mouth}" data-fish="${gutter.fishTail}">` +
    `${fields.join('')}${fish}</div>`
  );
}
