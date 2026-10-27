/**
 * XML / 字节基础读写（import-epub 内部共用层）
 *
 * 只做三件事：UTF-8 解码、`@xmldom/xmldom` 解析（致命错误收敛为中文 RangeError）、
 * 集合按下标取属性。所有解析类模块（OPF / NCX / nav / 正文文档）都经此层，
 * 避免把「解析 + 容错」逻辑在各处复制粘贴。
 */
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';

/** UTF-8 解码（TextDecoder 在浏览器 / Node / happy-dom 均为全局） */
export function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * 解析 XML
 *
 * 外部 epub 常含噪声（未声明前缀、重复属性等），非致命告警一律静默；
 * 致命错误转成带文档标签的中文 RangeError，便于定位是哪个文件坏了。
 *
 * @param xml XML 文本
 * @param label 文档标签（如 `content.opf`），只用于错误信息
 */
export function parseXml(xml: string, label: string): Document {
  const parser = new XmlDomParser({
    errorHandler: {
      warning: () => {},
      error: () => {},
      fatalError: (message: unknown) => {
        throw new Error(String(message));
      },
    },
  });
  try {
    return parser.parseFromString(xml, 'application/xml');
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new RangeError(`${label} 解析失败（XML 非法或已损坏）：${detail}`);
  }
}

/** 取集合中第 i 个元素的属性（兼容 noUncheckedIndexedAccess 的 null / undefined） */
export function attrAt(
  collection: { length: number; item(i: number): Element | null },
  i: number,
  name: string,
): string {
  return collection.item(i)?.getAttribute(name) ?? '';
}
