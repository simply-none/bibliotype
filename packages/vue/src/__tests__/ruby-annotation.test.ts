/**
 * ruby 注文识别测试（DOM 文本轴与模型文本轴同口径的前提）
 *
 * 注文（`<rt>` 注音 / `<rp>` 回退括号）是渲染期注释，不属模型文本；凡把 DOM
 * 文本折算为模型字符偏移处都必须排除，否则字符轴整体错位（选区 / 光标 / 行首偏移）。
 */
import { describe, expect, it } from 'vitest';
import { isRubyAnnotationElement, isRubyAnnotationText } from '../ruby-annotation.js';

/** 以 innerHTML 造一个片段容器 */
function frag(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('isRubyAnnotationElement', () => {
  it('识别 <rt> / <rp>，ruby 与普通元素不算', () => {
    const el = frag('<ruby>学<rt>xu</rt><rp>(</rp></ruby><span>x</span>');
    expect(isRubyAnnotationElement(el.querySelector('rt')!)).toBe(true);
    expect(isRubyAnnotationElement(el.querySelector('rp')!)).toBe(true);
    expect(isRubyAnnotationElement(el.querySelector('ruby')!)).toBe(false);
    expect(isRubyAnnotationElement(el.querySelector('span')!)).toBe(false);
  });
});

describe('isRubyAnnotationText', () => {
  it('注文文本命中，基字 / 正文文本不命中', () => {
    const el = frag('<ruby>学<rt>xu</rt></ruby>而时习之');
    const rt = el.querySelector('rt')!;
    const ruby = el.querySelector('ruby')!;
    expect(isRubyAnnotationText(rt.firstChild as Text, el)).toBe(true);
    expect(isRubyAnnotationText(ruby.firstChild as Text, el)).toBe(false); // 基字「学」
    expect(isRubyAnnotationText(el.lastChild as Text, el)).toBe(false); // 正文「而时习之」
  });

  it('root 之外（含同名 <rt>）不视为注文', () => {
    const outer = frag('<rt>outside</rt>');
    const root = document.createElement('div');
    root.innerHTML = 'plain';
    const outsideText = (outer.firstChild as Element).firstChild as Text;
    expect(isRubyAnnotationText(outsideText, root)).toBe(false);
  });
});
