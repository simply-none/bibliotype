/**
 * 校验 CLI 测试（E9）：退出码、JSON 输出、损坏包、缺省用法
 */
import { describe, expect, it } from 'vitest';
import { createEmptyDocument, NODE_TYPES } from '@bibliotype/core';
import { strToU8, zipSync } from 'fflate';
import { runValidateCli, type ValidateCliIo } from '../cli.js';
import { exportEpub } from '../epub.js';

const FIXED_MODIFIED = '2026-01-02T00:00:00Z';

function sampleEpub(): Uint8Array {
  const doc = createEmptyDocument({ title: '校验样本' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章' },
      children: [
        { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '正文' }] },
      ],
    },
  ];
  return exportEpub(doc, { modified: FIXED_MODIFIED });
}

function makeIo(bytes: Uint8Array | (() => Promise<Uint8Array>)): {
  io: ValidateCliIo;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      readFile: typeof bytes === 'function' ? bytes : async () => bytes,
      writeStdout: (text) => out.push(text),
      writeStderr: (text) => err.push(text),
    },
    out,
    err,
  };
}

describe('runValidateCli', () => {
  it('合法 EPUB 退出 0 并输出通过提示', async () => {
    const { io, out } = makeIo(sampleEpub());
    const result = await runValidateCli(['ok.epub'], io);
    expect(result.exitCode).toBe(0);
    expect(out.join('')).toContain('通过校验');
  });

  it('--json 输出可解析且 ok=true', async () => {
    const { io, out } = makeIo(sampleEpub());
    const result = await runValidateCli(['ok.epub', '--json'], io);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(out.join('')) as { ok: boolean; problems: unknown[] };
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.problems)).toBe(true);
  });

  it('缺少 OPF 的 zip 退出 1 并列出 error', async () => {
    const broken = zipSync({ 'hello.txt': strToU8('hi') });
    const { io, out } = makeIo(broken);
    const result = await runValidateCli(['broken.epub'], io);
    expect(result.exitCode).toBe(1);
    expect(result.problems.some((problem) => problem.severity === 'error')).toBe(true);
    expect(out.join('')).toContain('error');
  });

  it('非 zip 字节退出 2', async () => {
    const { io, err } = makeIo(strToU8('not a zip'));
    const result = await runValidateCli(['bad.epub'], io);
    expect(result.exitCode).toBe(2);
    expect(err.join('')).toContain('解包失败');
  });

  it('缺少文件参数退出 2', async () => {
    const { io, err } = makeIo(new Uint8Array());
    const result = await runValidateCli([], io);
    expect(result.exitCode).toBe(2);
    expect(err.join('')).toContain('缺少 EPUB 文件路径');
  });

  it('--help 退出 0', async () => {
    const { io, out } = makeIo(new Uint8Array());
    const result = await runValidateCli(['--help'], io);
    expect(result.exitCode).toBe(0);
    expect(out.join('')).toContain('bt-validate-epub');
  });
});
