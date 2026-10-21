/**
 * vitest 共享配置工厂（I4 覆盖率统一配置）
 *
 * 各包 vitest.config.ts 引用本工厂，统一 v8 provider、include/exclude 与
 * reporter 口径；仅设槛包（core / layout / reader）传入 thresholds，
 * 其余包走 CLI `vitest run --coverage`（只报告不拦）。
 */
import { defineConfig } from 'vitest/config';

export interface CoverageThresholds {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}

export interface CreateVitestConfigOptions {
  /** 覆盖率门槛（不传则只出报告） */
  thresholds?: CoverageThresholds;
}

/** 与测试同源的文件不参与覆盖率统计 */
const COVERAGE_EXCLUDE = [
  '**/__tests__/**',
  '**/fixtures/**',
  '**/*.d.ts',
  '**/dist/**',
] as const;

export function createVitestConfig(options: CreateVitestConfigOptions = {}) {
  return defineConfig({
    test: {
      coverage: {
        provider: 'v8',
        include: ['src/**'],
        exclude: [...COVERAGE_EXCLUDE],
        reporter: ['text', 'lcov'],
        // 本仓库开发环境的删除钩子不支持回收站操作，关闭覆盖率目录预清理；
        // reporter 仅 text + lcov（逐次覆写），不积累陈旧产物
        clean: false,
        ...(options.thresholds === undefined ? {} : { thresholds: options.thresholds }),
      },
    },
  });
}
