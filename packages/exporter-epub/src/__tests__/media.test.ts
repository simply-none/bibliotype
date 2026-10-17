/**
 * 媒体收集器测试（data URI → 包内独立文件）
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_MEDIA_BYTES,
  MediaCollector,
  parseDataImageUri,
  sniffImageMediaType,
} from '../media.js';

/** 1x1 PNG（base64） */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_URI = `data:image/png;base64,${PNG_B64}`;

describe('parseDataImageUri', () => {
  it('解析 base64 data URI（字节 + 声明类型）', () => {
    const parsed = parseDataImageUri(PNG_URI);
    expect(parsed).toBeDefined();
    expect(parsed?.mediaType).toBe('image/png');
    expect(parsed?.bytes.byteLength).toBeGreaterThan(0);
    /* PNG 魔术字节 */
    expect(sniffImageMediaType(parsed!.bytes)).toBe('image/png');
  });

  it('非 data URI / 非 base64 / 空数据返回 undefined', () => {
    expect(parseDataImageUri('https://x.test/a.png')).toBeUndefined();
    expect(parseDataImageUri('Images/a.png')).toBeUndefined();
    expect(parseDataImageUri('data:image/png,raw')).toBeUndefined();
    expect(parseDataImageUri('data:image/png;base64,')).toBeUndefined();
  });

  it('超大 data URI 拒绝打包（对齐导入侧上限）', () => {
    const big = `data:image/png;base64,${'A'.repeat(4 * 1024 * 1024)}`;
    expect(parseDataImageUri(big)).toBeUndefined();
    expect(MAX_MEDIA_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe('sniffImageMediaType', () => {
  it('识别 PNG / JPEG / GIF / WebP 魔术字节', () => {
    expect(sniffImageMediaType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImageMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageMediaType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif');
    expect(
      sniffImageMediaType(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe('image/webp');
    expect(sniffImageMediaType(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

describe('MediaCollector', () => {
  it('data URI 登记为 media 条目，rewrite 返回包内相对路径', () => {
    const collector = new MediaCollector();
    const rewritten = collector.rewrite(PNG_URI);
    expect(rewritten).toMatch(/^\.\.\/media\/img-[0-9a-f]{8}\.png$/);
    expect(collector.mediaItems).toHaveLength(1);
    expect(collector.mediaItems[0]?.mediaType).toBe('image/png');
    expect(collector.mediaProblems).toEqual([]);
  });

  it('同一 src 去重：重复 rewrite 不新增条目', () => {
    const collector = new MediaCollector();
    const first = collector.rewrite(PNG_URI);
    const second = collector.rewrite(PNG_URI);
    expect(second).toBe(first);
    expect(collector.mediaItems).toHaveLength(1);
  });

  it('register 供封面预登记：先拿 id，序列化期归并同一条目', () => {
    const collector = new MediaCollector();
    const cover = collector.register(PNG_URI);
    expect(cover?.id).toBe('media-1');
    /* 序列化期同图引用归并（不新增条目，改写值一致） */
    expect(collector.rewrite(PNG_URI)).toBe(`../${cover?.href}`);
    expect(collector.mediaItems).toHaveLength(1);
  });

  it('外链 / 易失地址 / 相对路径：原样透传并记 warning', () => {
    const collector = new MediaCollector();
    expect(collector.rewrite('https://x.test/a.png')).toBe('https://x.test/a.png');
    expect(collector.rewrite('//x.test/a.png')).toBe('//x.test/a.png');
    expect(collector.rewrite('blob:https://x/1')).toBe('blob:https://x/1');
    expect(collector.rewrite('Images/a.png')).toBe('Images/a.png');
    expect(collector.rewrite('')).toBe('');
    const codes = collector.mediaProblems.map((p) => p.code);
    expect(codes).toContain('external-src');
    expect(codes).toContain('volatile-src');
    expect(codes).toContain('relative-src');
    expect(collector.mediaItems).toEqual([]);
  });

  it('totalBytes 统计媒体总字节', () => {
    const collector = new MediaCollector();
    collector.rewrite(PNG_URI);
    collector.rewrite(PNG_URI);
    expect(collector.totalBytes).toBe(collector.mediaItems[0]?.bytes.byteLength);
  });
});
