/**
 * I6 VERSION 自动化：版本一致性测试（增量发布模型）
 *
 * 覆盖：
 *  1. core 源码 VERSION 常量与 packages/core/package.json 的 version 对账（各包版本可不同）；
 *  2. scripts/check-version.mjs 在真实仓库退出 0；
 *  3. 增量发布目标解析：只挑变更说明涉及的公开包，私有包条目跳过、未知包名仍报错、`--all` 全量；
 *  4. 写回函数幂等（同值二次写入零 diff）+ 负例（version.ts 漂移 / 常量缺失）。
 *
 * fixture 一律使用日期版本形式，与 scripts/version.mjs 的产出规则一致。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { VERSION } from '../version';
// 仓内脚本（纯 Node ESM，类型见 __tests__/externals.d.ts）
// eslint-disable-next-line import/no-relative-packages
import { resolveTargets, updateCoreVersionTs, updateVersionField } from '../../../../scripts/version.mjs';
// eslint-disable-next-line import/no-relative-packages
import { checkVersions } from '../../../../scripts/check-version.mjs';

const CHECK_SCRIPT = fileURLToPath(new URL('../../../../scripts/check-version.mjs', import.meta.url));
const CORE_MANIFEST = fileURLToPath(new URL('../../package.json', import.meta.url));

/** 日期版本形式样例（与 scripts/version.mjs 产出规则一致） */
const DATE_VERSION = '26.10.21';
const RC_VERSION = '26.10.21-rc.1';

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

function writeFixture(root: string, relPath: string, content: string): void {
  const target = join(root, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

/** 构造最小工作区 fixture：两个公开包（core / alpha）+ 一个 private 包（应被忽略） */
function createFixture(options: {
  version?: string;
  coreVersionTs?: string; // version.ts 中的 VERSION 值
  omitVersionConstant?: boolean;
}): string {
  const root = mkdtempSync(join(tmpdir(), 'bibliotype-version-'));
  tempRoots.push(root);
  const version = options.version ?? DATE_VERSION;
  writeFixture(root, 'pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
  writeFixture(
    root,
    'packages/core/package.json',
    `${JSON.stringify({ name: '@bibliotype/core', version }, null, 2)}\n`,
  );
  writeFixture(
    root,
    'packages/alpha/package.json',
    `${JSON.stringify({ name: '@bibliotype/alpha', version }, null, 2)}\n`,
  );
  writeFixture(
    root,
    'packages/private-demo/package.json',
    `${JSON.stringify({ name: 'private-demo', version: '0.0.0', private: true }, null, 2)}\n`,
  );
  const versionTs = options.omitVersionConstant === true
    ? 'export const OTHER = 1;\n'
    : `/** 包版本常量 */\nexport const VERSION = '${options.coreVersionTs ?? version}';\n`;
  writeFixture(root, 'packages/core/src/version.ts', versionTs);
  return root;
}

describe('I6 版本单源一致性', () => {
  it('core 源码 VERSION 与 packages/core/package.json 的 version 对账', () => {
    const manifest = JSON.parse(readFileSync(CORE_MANIFEST, 'utf8')) as { version: string };
    expect(manifest.version).not.toBe('');
    expect(VERSION).toBe(manifest.version);
  });

  it('check-version.mjs 在真实仓库退出 0', () => {
    const result = spawnSync(process.execPath, [CHECK_SCRIPT], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('版本一致');
  });

  describe('fixture 校验（checkVersions）', () => {
    it('公开包版本可各不相同（增量发布），private 包被忽略', () => {
      const root = createFixture({});
      writeFixture(
        root,
        'packages/alpha/package.json',
        `${JSON.stringify({ name: '@bibliotype/alpha', version: '26.10.20' }, null, 2)}\n`,
      );
      const result = checkVersions({ root });
      expect(result.ok).toBe(true);
      expect(result.version).toBe(DATE_VERSION);
      expect(result.publicCount).toBe(2); // private-demo 不计入
    });

    it('rc 通道版本形式（YY.M.D-rc.N）同样通过', () => {
      const root = createFixture({ version: RC_VERSION });
      const result = checkVersions({ root });
      expect(result.version).toBe(RC_VERSION);
    });

    it('负例：version.ts 漂移时抛错并指出两侧值', () => {
      const root = createFixture({ coreVersionTs: '25.1.1' });
      expect(() => checkVersions({ root })).toThrowError(
        /VERSION（25\.1\.1）.*version（26\.10\.21）不一致/s,
      );
    });

    it('负例：version.ts 缺失 VERSION 常量时抛错', () => {
      const root = createFixture({ omitVersionConstant: true });
      expect(() => checkVersions({ root })).toThrowError(/定位 VERSION 常量/);
    });
  });

  describe('增量发布目标解析（resolveTargets）', () => {
    const packages = [
      { name: '@bibliotype/core', private: false },
      { name: '@bibliotype/vue', private: false },
      { name: '@bibliotype/demo', private: true },
    ];
    const coreChangeset = {
      file: 'core-change.md',
      summary: '改 core',
      releases: [
        { name: '@bibliotype/core', type: 'patch' },
        { name: '@bibliotype/demo', type: 'patch' },
      ],
    };

    it('只挑变更说明涉及的公开包，私有包条目跳过且不中止', () => {
      const result = resolveTargets({ packages, changesets: [coreChangeset], all: false });
      expect(result.targets.map((p: { name: string }) => p.name)).toEqual(['@bibliotype/core']);
      expect(result.skipped).toHaveLength(1);
      expect(result.entriesByPackage.get('@bibliotype/vue')).toEqual([]); // 未变更包不写 CHANGELOG
    });

    it('--all 时全部公开包都升版（首次发布用）', () => {
      const result = resolveTargets({ packages, changesets: [coreChangeset], all: true });
      expect(result.targets.map((p: { name: string }) => p.name)).toEqual([
        '@bibliotype/core',
        '@bibliotype/vue',
      ]);
    });

    it('负例：未知包名仍报错（拼写保护）', () => {
      const changesets = [
        { file: 'typo.md', summary: 'x', releases: [{ name: '@bibliotype/nope', type: 'patch' }] },
      ];
      expect(() => resolveTargets({ packages, changesets, all: false })).toThrowError(/未知的包/);
    });

    it('负例：变更说明只涉及私有包时以退出码 2 中止', () => {
      const changesets = [
        { file: 'demo.md', summary: 'x', releases: [{ name: '@bibliotype/demo', type: 'patch' }] },
      ];
      let caught: unknown;
      try {
        resolveTargets({ packages, changesets, all: false });
      } catch (error) {
        caught = error;
      }
      expect((caught as { exitCode?: number } | undefined)?.exitCode).toBe(2);
    });
  });

  describe('写回函数幂等', () => {
    it('updateCoreVersionTs 同值二次写入零 diff', () => {
      const root = createFixture({});
      const versionTsPath = join(root, 'packages/core/src/version.ts');

      updateCoreVersionTs(root, DATE_VERSION);
      const afterFirst = readFileSync(versionTsPath, 'utf8');
      updateCoreVersionTs(root, DATE_VERSION);
      expect(readFileSync(versionTsPath, 'utf8')).toBe(afterFirst); // 二次无 diff
      expect(afterFirst).toContain(`VERSION = '${DATE_VERSION}'`);
      expect(afterFirst).toContain('/** 包版本常量 */'); // 其余内容保留
    });

    it('updateCoreVersionTs 支持 rc 形式版本并保留引号风格', () => {
      const root = createFixture({});
      updateCoreVersionTs(root, RC_VERSION);
      expect(readFileSync(join(root, 'packages/core/src/version.ts'), 'utf8')).toContain(
        `VERSION = '${RC_VERSION}'`,
      );
    });

    it('负例：漏传版本号时抛错且保持原值（防止写入字面量 undefined）', () => {
      const root = createFixture({});
      const versionTsPath = join(root, 'packages/core/src/version.ts');
      expect(() => updateCoreVersionTs(root)).toThrowError(/有效的版本号/);
      expect(readFileSync(versionTsPath, 'utf8')).toContain(`VERSION = '${DATE_VERSION}'`);
    });

    it('updateVersionField 同值二次写入零 diff', () => {
      const root = createFixture({});
      const manifestPath = join(root, 'packages/core/package.json');
      const pkg = { dir: join(root, 'packages/core'), relDir: 'packages/core', manifestPath } as const;

      updateVersionField(pkg, DATE_VERSION);
      const afterFirst = readFileSync(manifestPath, 'utf8');
      updateVersionField(pkg, DATE_VERSION);
      expect(readFileSync(manifestPath, 'utf8')).toBe(afterFirst); // 二次无 diff
    });

    it('负例：文件无 VERSION 常量 / 无 version 字段时抛错且不写入', () => {
      const root = createFixture({ omitVersionConstant: true });
      expect(() => updateCoreVersionTs(root, DATE_VERSION)).toThrowError(/定位 VERSION 常量/);
      expect(readFileSync(join(root, 'packages/core/src/version.ts'), 'utf8')).not.toContain(DATE_VERSION);

      const manifestPath = join(root, 'packages/core/src/no-version.json');
      writeFileSync(manifestPath, '{"name":"x"}\n', 'utf8');
      expect(() => updateVersionField({ dir: root, relDir: 'x', manifestPath } as never, DATE_VERSION)).toThrowError(
        /定位 version 字段/,
      );
    });
  });
});
