/**
 * Demo 宿主的 ZIP 能力（`BookPackCodec` 实现）
 *
 * 为什么不引第三方库：`core` 的 `.btbook` / 备份只定义「文件规划」，压缩由宿主
 * 注入；demo 用 STORE（不压缩）方式实现最小 ZIP 读写，零依赖、确定性（固定
 * 1980-01-01 时间戳），足以验证打包 / 解包 / 导入导出闭环。
 *
 * 生产宿主（Electron / Node）可换成 `zlib` 或 `fflate` 的 DEFLATE 实现。
 */
import type { BookPackCodec, BookPackFile } from '@bibliotype/core';

/** ZIP 本地文件头签名 */
const LOCAL_SIG = 0x04034b50;
/** ZIP 中央目录签名 */
const CENTRAL_SIG = 0x02014b50;
/** ZIP 目录结束签名 */
const EOCD_SIG = 0x06054b50;
/** UTF-8 文件名标志位 */
const UTF8_FLAG = 0x0800;
/** 固定 DOS 日期（1980-01-01），保证产物确定性 */
const DOS_DATE = 0x0021;
/** 固定 DOS 时间（00:00:00） */
const DOS_TIME = 0x0000;

/** CRC32 查表（延迟初始化，避免模块加载开销） */
let crcTable: Uint32Array | undefined;

/** 取 CRC32 表 */
function getCrcTable(): Uint32Array {
  if (crcTable !== undefined) {
    return crcTable;
  }
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  crcTable = table;
  return table;
}

/** 计算 CRC32 */
export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 计算可容纳 n 个条目的中央目录大小 */
function centralSize(files: readonly BookPackFile[]): number {
  let size = 0;
  for (const file of files) {
    size += 46 + file.path.length;
  }
  return size;
}

/** 打包为 ZIP（STORE 方式） */
export function zipFiles(files: readonly BookPackFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const entries = files.map((file) => ({
    name: encoder.encode(file.path),
    data: file.data,
  }));
  let localSize = 0;
  for (const entry of entries) {
    localSize += 30 + entry.name.length + entry.data.length;
  }
  const total = localSize + centralSize(files) + 22;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let offset = 0;
  const offsets: number[] = [];
  for (const entry of entries) {
    offsets.push(offset);
    const crc = crc32(entry.data);
    view.setUint32(offset, LOCAL_SIG, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, UTF8_FLAG, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, DOS_TIME, true);
    view.setUint16(offset + 12, DOS_DATE, true);
    view.setUint32(offset + 14, crc, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, entry.name.length, true);
    view.setUint16(offset + 28, 0, true);
    bytes.set(entry.name, offset + 30);
    bytes.set(entry.data, offset + 30 + entry.name.length);
    offset += 30 + entry.name.length + entry.data.length;
  }

  const centralOffset = offset;
  entries.forEach((entry, index) => {
    const crc = crc32(entry.data);
    view.setUint32(offset, CENTRAL_SIG, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, UTF8_FLAG, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, DOS_TIME, true);
    view.setUint16(offset + 14, DOS_DATE, true);
    view.setUint32(offset + 16, crc, true);
    view.setUint32(offset + 20, entry.data.length, true);
    view.setUint32(offset + 24, entry.data.length, true);
    view.setUint16(offset + 28, entry.name.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, offsets[index] ?? 0, true);
    bytes.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  });

  view.setUint32(offset, EOCD_SIG, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, offset - centralOffset, true);
  view.setUint32(offset + 16, centralOffset, true);
  view.setUint16(offset + 20, 0, true);
  return bytes;
}

/** 在字节流中定位 EOCD（从尾部向前扫描） */
function findEndOfCentralDirectory(view: DataView): number {
  const start = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIG) {
      return offset;
    }
  }
  throw new Error('ZIP 结构损坏：找不到中央目录（文件可能被截断）。');
}

/** 解开 ZIP（支持 STORE；遇到 DEFLATE 条目给出明确错误） */
export function unzipFiles(bytes: Uint8Array): BookPackFile[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder('utf-8');

  const files: BookPackFile[] = [];
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_SIG) {
      throw new Error('ZIP 结构损坏：中央目录条目签名不正确。');
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    if (method !== 0) {
      throw new Error(`ZIP 条目 ${name} 使用了压缩方式 ${method}，当前 demo 仅支持 STORE 打包。`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    files.push({
      path: name,
      data: bytes.slice(dataStart, dataStart + compressedSize),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/** 供 demo 使用的 ZIP 端口 */
export const demoZipCodec: BookPackCodec = {
  async zip(files: readonly BookPackFile[]): Promise<Uint8Array> {
    return zipFiles(files);
  },
  async unzip(data: Uint8Array): Promise<BookPackFile[]> {
    return unzipFiles(data);
  },
};
