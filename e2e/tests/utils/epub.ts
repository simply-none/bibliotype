/**
 * EPUB 产物校验（I1 导出链路）
 *
 * 用 fflate 解包导出字节，按 EPUB 规范检查最小结构：
 * `mimetype` 无压缩首项、`META-INF/container.xml`、OPF 元数据、
 * 以及章节 XHTML 中确实含编辑后的文字（导出所见即所得）。
 */
import { strFromU8, unzipSync } from 'fflate';

export interface EpubPackage {
  /** 全部条目（路径 → 字节） */
  entries: Record<string, Uint8Array>;
  /** 读文本条目（不存在返回 undefined） */
  text(path: string): string | undefined;
  /** 找到包含指定文本的 XHTML 条目 */
  findXhtmlContaining(needle: string): string | undefined;
  /** OPF 文本 */
  opf(): string;
}

/** 解包并返回便于断言的视图 */
export function readEpub(bytes: Uint8Array): EpubPackage {
  const entries = unzipSync(bytes);
  const text = (path: string): string | undefined => {
    const data = entries[path];
    return data === undefined ? undefined : strFromU8(data);
  };
  const opfPath = Object.keys(entries).find((path) => path.endsWith('.opf'));
  return {
    entries,
    text,
    opf: () => (opfPath === undefined ? '' : (text(opfPath) ?? '')),
    findXhtmlContaining(needle: string): string | undefined {
      return Object.keys(entries)
        .filter((path) => path.endsWith('.xhtml') || path.endsWith('.html'))
        .find((path) => (text(path) ?? '').includes(needle));
    },
  };
}
