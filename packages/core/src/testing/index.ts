/**
 * 测试辅助子入口（`@bibliotype/core/testing`）
 *
 * 只给各适配器的测试使用，依赖 vitest，不进入主入口。
 */
export {
  runStorageContractTests,
  sampleBookDocument,
  sampleDocument,
} from './storage-contract.js';
export type { ContractAdapter, StorageContractOptions } from './storage-contract.js';
