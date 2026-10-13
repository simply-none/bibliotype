/**
 * HTML → BookDocument（副作用层：DOM 解析）
 *
 * 依赖方向：import → editor（pmNodeToIr）、prosemirror-model（DOMParser）。
 * 本模块是 import 包内**唯一**触碰 DOM 之处（§3.2 副作用隔离）：
 * - 浏览器环境：直接用全局 `document` 解析 `html` 字符串；
 * - Node / 测试 / epub 复用：可注入已解析好的容器元素（`container`），绕开全局依赖。
 * 标准标签 → PM 结构由 core/editor 规格登记的 `parseDOM` 规则负责（7.3 已扩充）。
 */
import { IR_SCHEMA_VERSION, type BookDocument, type BookMetadata } from '@bibliotype/core';
import { pmNodeToIr } from '@bibliotype/editor';
import { DOMParser as PmDomParser, type Schema } from 'prosemirror-model';

/**
 * 将 HTML 片段导入为 BookDocument
 *
 * @param html HTML 字符串（`container` 提供时忽略）
 * @param schema 编辑器 schema（topNode 应为 `book`）
 * @param metadata 书目元数据（由调用方注入）
 * @param container 可选的已解析 DOM 容器元素（Node / 测试 / epub 注入用）；缺省用全局 `document` 解析 `html`
 */
export function htmlToBookDocument(
  html: string,
  schema: Schema,
  metadata: BookMetadata,
  container?: Element,
): BookDocument {
  let el = container;
  if (el === undefined) {
    if (typeof document === 'undefined') {
      throw new RangeError(
        '当前环境无全局 document：Node / SSR 请注入已解析的 container 元素，或在 happy-dom 等 DOM 环境中运行。',
      );
    }
    el = document.createElement('div');
    el.innerHTML = html;
  }
  // parse 直接产出 topNode（book）根节点，再回收为 IR
  const rootPm = PmDomParser.fromSchema(schema).parse(el);
  return {
    schemaVersion: IR_SCHEMA_VERSION,
    metadata,
    root: pmNodeToIr(rootPm),
  };
}
