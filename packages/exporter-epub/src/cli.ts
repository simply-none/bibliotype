/**
 * EPUB 校验命令行（纯逻辑，可单测）
 *
 * 只做一件事：读取 `.epub` → 解包 → 复用 `validateEpub` → 输出问题与退出码。
 * 文件系统与输出均通过 {@link ValidateCliIo} 注入，便于在 node 测试中替换；
 * 薄壳入口见 `bin/bt-validate-epub.mjs`。
 *
 * 退出码：`0` 无 error（warning 不阻断）；`1` 存在 error；`2` 用法 / 读取 / 解包失败。
 */
import { strFromU8, unzipSync } from 'fflate';
import { validateEpub, type ValidationProblem } from './validate.js';

/** CLI 依赖注入端口 */
export interface ValidateCliIo {
  /** 读取文件（返回原始字节） */
  readFile: (path: string) => Promise<Uint8Array>;
  /** 标准输出 */
  writeStdout: (text: string) => void;
  /** 错误输出 */
  writeStderr: (text: string) => void;
}

/** CLI 运行结果 */
export interface ValidateCliResult {
  /** 退出码（0 通过 / 1 有 error / 2 用法或读取失败） */
  exitCode: number;
  /** 校验问题（读取失败时为空数组） */
  problems: readonly ValidationProblem[];
}

/** 命令行用法 */
export const VALIDATE_CLI_USAGE = `用法：bt-validate-epub <file.epub> [--json] [--max-section-bytes=<n>]

  --json                  以 JSON 输出（{ ok, problems }）
  --max-section-bytes=<n> 单内容文档字节上限（与导出器同阈值，缺省 256KiB）
  --help                  显示本帮助`;

/** 从 OPF 内容解析 package 版本（缺省 3.0） */
function parseOpfVersion(opf: string | undefined): string {
  if (opf === undefined) return '3.0';
  const match = /<package\b[^>]*\bversion\s*=\s*["']([^"']+)["']/.exec(opf);
  return match?.[1] ?? '3.0';
}

/** 格式化单条问题（人类可读） */
function formatProblem(problem: ValidationProblem): string {
  const path = problem.path === undefined ? '' : ` ${problem.path}`;
  return `[${problem.severity}] ${problem.code}${path}: ${problem.message}`;
}

/**
 * 运行校验 CLI
 *
 * @param args 命令行参数（不含 node 与脚本路径）
 * @param io 注入的文件读取与输出
 */
export async function runValidateCli(
  args: readonly string[],
  io: ValidateCliIo,
): Promise<ValidateCliResult> {
  const flags = new Set<string>();
  let file: string | undefined;
  let maxSectionBytes: number | undefined;

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      flags.add('help');
    } else if (arg === '--json') {
      flags.add('json');
    } else if (arg.startsWith('--max-section-bytes=')) {
      const parsed = Number.parseInt(arg.slice('--max-section-bytes='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) maxSectionBytes = parsed;
    } else if (arg.startsWith('-')) {
      io.writeStderr(`未知选项：${arg}\n\n${VALIDATE_CLI_USAGE}\n`);
      return { exitCode: 2, problems: [] };
    } else if (file === undefined) {
      file = arg;
    }
  }

  if (flags.has('help')) {
    io.writeStdout(`${VALIDATE_CLI_USAGE}\n`);
    return { exitCode: 0, problems: [] };
  }
  if (file === undefined) {
    io.writeStderr(`缺少 EPUB 文件路径\n\n${VALIDATE_CLI_USAGE}\n`);
    return { exitCode: 2, problems: [] };
  }

  let bytes: Uint8Array;
  try {
    bytes = await io.readFile(file);
  } catch (error) {
    io.writeStderr(`读取失败：${file}（${(error as Error).message}）\n`);
    return { exitCode: 2, problems: [] };
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    io.writeStderr(`解包失败：${file} 不是有效的 EPUB / ZIP（${(error as Error).message}）\n`);
    return { exitCode: 2, problems: [] };
  }

  const opfPath = Object.keys(entries).find((name) => name.toLowerCase().endsWith('.opf'));
  const opf = opfPath === undefined ? undefined : strFromU8(entries[opfPath]!);
  const problems = validateEpub({
    entries,
    version: parseOpfVersion(opf),
    ...(maxSectionBytes === undefined ? {} : { maxSectionBytes }),
  });

  const errors = problems.filter((problem) => problem.severity === 'error');
  const exitCode = errors.length > 0 ? 1 : 0;

  if (flags.has('json')) {
    io.writeStdout(`${JSON.stringify({ ok: exitCode === 0, problems }, null, 2)}\n`);
  } else {
    if (problems.length === 0) {
      io.writeStdout(`${file}：通过校验（0 个问题）\n`);
    } else {
      io.writeStdout(
        `${file}：${problems.length} 个问题（${errors.length} error / ${problems.length - errors.length} warning）\n`,
      );
      for (const problem of problems) io.writeStdout(`${formatProblem(problem)}\n`);
    }
  }

  return { exitCode, problems };
}
