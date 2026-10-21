/**
 * Demo 书库组合式（H3–H5 / C5 / C7 的宿主接线）
 *
 * 把「存储 + 压缩 + 版本 + 加密」四件事装在一个组合式里，供 `LibraryDrawer`
 * 与 App 复用；示例应用只负责界面，不重复实现业务逻辑。
 */
import {
  BACKUP_CONFLICT_STRATEGIES,
  buildLibraryBackupFiles,
  countDocumentStats,
  createEncryptedStorageAdapter,
  createSnapshot,
  createStringCipher,
  deriveKeyPbkdf2,
  diffDocuments,
  isBookSummaryStore,
  nextSnapshotVersion,
  packBookArchive,
  randomBytes,
  restoreLibrary,
  restoreSnapshot,
  selectExpiredSnapshots,
} from '@bibliotype/core';
import type {
  BackupConflictStrategy,
  BookDocument,
  DocumentDiff,
  DocumentSnapshot,
  DocumentSnapshotMeta,
  DocumentSummary,
  LibraryRestoreProgress,
  LibraryRestoreResult,
  RedactOptions,
  StringCipher,
} from '@bibliotype/core';
import { IndexedDbAdapter, IndexedDbVersionStore } from '@bibliotype/adapter-indexeddb';
import { useBookLibrary } from '@bibliotype/vue';
import type { UseBookLibraryReturn } from '@bibliotype/vue';
import { reactive, ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import { demoZipCodec } from '../zip-codec.js';

/** 书库库名 / 仓名 */
const LIBRARY_DB = 'bibliotype-demo-library';
const LIBRARY_STORE = 'books';
/** 加密元信息（盐 + 校验串）与密文书的本地键 */
const CRYPTO_META_KEY = 'bibliotype-demo-crypto-meta';
const SEALED_DOC_KEY = 'bibliotype-demo-sealed-draft';
/** PBKDF2 迭代次数（demo 取较低值以缩短等待，生产建议 210000） */
const DEMO_ITERATIONS = 60_000;

/** 加密状态 */
export interface DemoCryptoState {
  /** 是否已开启加密 */
  enabled: boolean;
  /** 本次会话是否已解锁 */
  unlocked: boolean;
  /** 注记是否单独加锁 */
  notesLocked: boolean;
  /** 错误信息 */
  error: string;
}

/** 加密元信息 */
interface CryptoMeta {
  /** 盐（base64） */
  salt: string;
  /** 口令校验串（密文，用于验证口令是否正确） */
  verifier: string;
}

/** 读取本地加密元信息 */
function readCryptoMeta(): CryptoMeta | undefined {
  const raw = globalThis.localStorage?.getItem(CRYPTO_META_KEY);
  if (raw === null || raw === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as CryptoMeta;
  } catch {
    return undefined;
  }
}

/** base64 互转（仅 demo 本地使用） */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** 触发浏览器下载 */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** demo 书库 API */
export interface DemoLibraryApi {
  /** 书架状态 */
  library: UseBookLibraryReturn;
  /** 加密状态 */
  crypt: DemoCryptoState;
  /** 备份进度 */
  progress: Ref<{ current: number; total: number; title?: string } | null>;
  /** 最近一次恢复结果 */
  lastRestore: ShallowRef<LibraryRestoreResult | null>;
  /** 把当前文档存入书库 */
  saveBook: (document: BookDocument, id: string) => Promise<void>;
  /** 读取书库文档 */
  readBook: (id: string) => Promise<BookDocument | undefined>;
  /** 导出整库 */
  exportLibrary: () => Promise<void>;
  /** 从备份恢复 */
  importLibrary: (bytes: Uint8Array, strategy: BackupConflictStrategy) => Promise<void>;
  /** 记录快照 */
  snapshot: (documentId: string, document: BookDocument, label: string) => Promise<DocumentSnapshotMeta>;
  /** 版本列表 / 快照读取 / 清理 */
  listVersions: (documentId: string) => Promise<DocumentSnapshotMeta[]>;
  loadVersion: (documentId: string, version: number) => Promise<DocumentSnapshot | undefined>;
  compareVersions: (
    documentId: string,
    leftVersion: number,
    rightDocument: BookDocument,
  ) => Promise<DocumentDiff | null>;
  pruneVersions: (documentId: string, maxCount: number) => Promise<number[]>;
  /** 加密：开启 / 解锁 / 关闭 */
  enableEncryption: (password: string) => Promise<void>;
  unlockEncryption: (password: string) => Promise<void>;
  disableEncryption: () => void;
  /** 加密保存当前草稿 / 解密读取 */
  sealDraft: (document: BookDocument) => Promise<void>;
  openSealedDraft: () => Promise<BookDocument | undefined>;
  /** 导出脱敏选项 */
  redact: RedactOptions;
  /** 当前密码派生器（已解锁时） */
  cipher: () => StringCipher | undefined;
}

/** 组合式：demo 书库 */
export function useDemoLibrary(): DemoLibraryApi {
  const adapter = new IndexedDbAdapter({ databaseName: LIBRARY_DB, storeName: LIBRARY_STORE });
  const versionStore = new IndexedDbVersionStore();
  const library = useBookLibrary({ store: adapter, codec: demoZipCodec });

  const crypt = reactive<DemoCryptoState>({
    enabled: readCryptoMeta() !== undefined,
    unlocked: false,
    notesLocked: false,
    error: '',
  });
  const activeCipher = shallowRef<StringCipher | undefined>(undefined);
  const progress = ref<{ current: number; total: number; title?: string } | null>(null);
  const lastRestore = shallowRef<LibraryRestoreResult | null>(null);
  const redact = reactive<RedactOptions>({});

  /** 派生密钥并生成校验串 */
  async function deriveCipher(password: string, salt: Uint8Array): Promise<StringCipher> {
    const key = await deriveKeyPbkdf2({ password, salt, iterations: DEMO_ITERATIONS });
    return createStringCipher(key);
  }

  async function enableEncryption(password: string): Promise<void> {
    crypt.error = '';
    try {
      const salt = randomBytes(16);
      const cipher = await deriveCipher(password, salt);
      const verifier = await cipher.encrypt('bibliotype-verifier');
      const meta: CryptoMeta = { salt: toBase64(salt), verifier: JSON.stringify(verifier) };
      globalThis.localStorage?.setItem(CRYPTO_META_KEY, JSON.stringify(meta));
      activeCipher.value = cipher;
      crypt.enabled = true;
      crypt.unlocked = true;
    } catch (cause) {
      crypt.error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function unlockEncryption(password: string): Promise<void> {
    crypt.error = '';
    const meta = readCryptoMeta();
    if (meta === undefined) {
      crypt.error = '本机没有加密记录，请先开启加密。';
      return;
    }
    try {
      const cipher = await deriveCipher(password, fromBase64(meta.salt));
      await cipher.decrypt(JSON.parse(meta.verifier) as never);
      activeCipher.value = cipher;
      crypt.unlocked = true;
    } catch {
      crypt.error = '口令错误或数据已损坏，请重试。';
    }
  }

  function disableEncryption(): void {
    globalThis.localStorage?.removeItem(CRYPTO_META_KEY);
    globalThis.localStorage?.removeItem(SEALED_DOC_KEY);
    activeCipher.value = undefined;
    crypt.enabled = false;
    crypt.unlocked = false;
    crypt.error = '';
  }

  async function sealDraft(document: BookDocument): Promise<void> {
    const cipher = activeCipher.value;
    if (cipher === undefined) {
      throw new Error('请先解锁加密。');
    }
    const encrypted = createEncryptedStorageAdapter({ inner: adapter, cipher });
    await encrypted.save('sealed-draft', document, { updatedAt: Date.now() });
    globalThis.localStorage?.setItem(SEALED_DOC_KEY, '1');
  }

  async function openSealedDraft(): Promise<BookDocument | undefined> {
    const cipher = activeCipher.value;
    if (cipher === undefined) {
      throw new Error('请先解锁加密。');
    }
    const encrypted = createEncryptedStorageAdapter({ inner: adapter, cipher });
    return encrypted.load('sealed-draft');
  }

  async function saveBook(document: BookDocument, id: string): Promise<void> {
    const updatedAt = Date.now();
    await adapter.save(id, document, { updatedAt });
    if (isBookSummaryStore(adapter)) {
      await adapter.updateSummary(id, {
        progress: 0,
        lastOpenedAt: updatedAt,
      });
    }
    await library.refresh();
  }

  async function readBook(id: string): Promise<BookDocument | undefined> {
    return adapter.load(id);
  }

  async function exportLibrary(): Promise<void> {
    const summaries: DocumentSummary[] = await adapter.list();
    progress.value = { current: 0, total: summaries.length };
    const books: { id: string; title: string; archive: Uint8Array }[] = [];

    for (const summary of summaries) {
      const document = await adapter.load(summary.id);
      if (document !== undefined) {
        const archive = await packBookArchive(
          {
            id: summary.id,
            document,
            createdAt: Date.now(),
            summary,
          },
          demoZipCodec,
        );
        books.push({ id: summary.id, title: summary.title, archive });
      }
      progress.value = {
        current: books.length,
        total: summaries.length,
        title: summary.title,
      };
    }

    const files = buildLibraryBackupFiles({
      createdAt: Date.now(),
      books,
      settings: { demo: true },
    });
    downloadBytes(await demoZipCodec.zip(files), 'bibliotype-library.zip');
    progress.value = null;
  }

  async function importLibrary(
    bytes: Uint8Array,
    strategy: BackupConflictStrategy,
  ): Promise<void> {
    const files = await demoZipCodec.unzip(bytes);
    progress.value = { current: 0, total: 0 };
    const result = await restoreLibrary({
      files,
      codec: demoZipCodec,
      target: adapter,
      strategy,
      onProgress: (item: LibraryRestoreProgress) => {
        progress.value = { current: item.current, total: item.total, title: item.title };
      },
    });
    lastRestore.value = result;
    progress.value = null;
    await library.refresh();
  }

  async function snapshot(
    documentId: string,
    document: BookDocument,
    label: string,
  ): Promise<DocumentSnapshotMeta> {
    const metas = await versionStore.listVersions(documentId);
    const snapshotValue = createSnapshot({
      documentId,
      document,
      version: nextSnapshotVersion(metas),
      createdAt: Date.now(),
      label,
      wordCount: countDocumentStats(document).characters,
    });
    const meta = await versionStore.saveVersion(snapshotValue);
    const expired = selectExpiredSnapshots(await versionStore.listVersions(documentId), {
      maxCount: 20,
      now: Date.now(),
    });
    for (const item of expired) {
      await versionStore.deleteVersion(documentId, item.version);
    }
    return meta;
  }

  async function compareVersions(
    documentId: string,
    leftVersion: number,
    rightDocument: BookDocument,
  ): Promise<DocumentDiff | null> {
    const snapshotValue = await versionStore.loadVersion(documentId, leftVersion);
    if (snapshotValue === undefined) {
      return null;
    }
    const restored = restoreSnapshot(snapshotValue);
    if (!restored.ok) {
      throw new Error(restored.message);
    }
    return diffDocuments(restored.document, rightDocument);
  }

  return {
    library,
    crypt,
    progress,
    lastRestore,
    saveBook,
    readBook,
    exportLibrary,
    importLibrary,
    snapshot,
    listVersions: (documentId) => versionStore.listVersions(documentId),
    loadVersion: (documentId, version) => versionStore.loadVersion(documentId, version),
    compareVersions,
    pruneVersions: (documentId, maxCount) =>
      versionStore.pruneVersions(documentId, { maxCount, now: Date.now() }),
    enableEncryption,
    unlockEncryption,
    disableEncryption,
    sealDraft,
    openSealedDraft,
    redact,
    cipher: () => activeCipher.value,
  };
}

/** 默认策略（导出给面板占位） */
export const DEFAULT_BACKUP_STRATEGY: BackupConflictStrategy =
  BACKUP_CONFLICT_STRATEGIES.MERGE;
