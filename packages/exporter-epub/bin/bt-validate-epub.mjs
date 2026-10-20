#!/usr/bin/env node
/**
 * bt-validate-epub 薄壳入口
 *
 * 仅做「进程适配」：读文件、写标准输出 / 错误、按结果设置退出码。
 * 校验逻辑全部在 `src/cli.ts` 的 `runValidateCli`（可单测，不依赖进程）。
 */
import { readFile } from 'node:fs/promises';
import { runValidateCli } from '../dist/index.js';

/** 进程侧 IO 适配 */
const io = {
  /** 读取文件为字节 */
  readFile: async (path) => new Uint8Array(await readFile(path)),
  /** 标准输出 */
  writeStdout: (text) => process.stdout.write(text),
  /** 错误输出 */
  writeStderr: (text) => process.stderr.write(text),
};

const result = await runValidateCli(process.argv.slice(2), io);
process.exit(result.exitCode);
