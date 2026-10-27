import type {
  AlgorithmId,
  BackupDocument,
  DrawRecord,
  PredictionEvaluation,
  PredictionSnapshot,
} from "../types";

const DATABASE_NAME = "shuangseqiu-probability-lab";
const DATABASE_VERSION = 1;
const DRAW_STORE = "draws";
const SNAPSHOT_STORE = "predictionSnapshots";
const EVALUATION_STORE = "evaluations";
const METADATA_STORE = "metadata";
const ACTIVE_ALGORITHM_KEY = "active-algorithm";
const LEGACY_MIGRATION_KEY = "legacy-migrated-v1";

const LEGACY_DRAW_KEY = "shuangseqiu-probability-lab:draws:v1";
const LEGACY_REVIEW_KEY = "shuangseqiu-probability-lab:review:v1";
const LEGACY_ACTIVE_ALGORITHM_KEY =
  "shuangseqiu-probability-lab:active-algorithm:v1";

type StoreName =
  | typeof DRAW_STORE
  | typeof SNAPSHOT_STORE
  | typeof EVALUATION_STORE
  | typeof METADATA_STORE;

interface MetadataRecord {
  key: string;
  value: unknown;
}

interface LegacyReviewRecord {
  snapshots: unknown[];
  evaluations: unknown[];
}

export interface StorageInitializeResult {
  migrationWarning: string | null;
}

export interface LotteryLabStorage {
  initialize(): Promise<StorageInitializeResult>;
  getDraws(): Promise<DrawRecord[]>;
  putDraw(draw: DrawRecord): Promise<void>;
  putDraws(draws: readonly DrawRecord[]): Promise<void>;
  replaceDraws(draws: readonly DrawRecord[]): Promise<void>;
  getSnapshots(): Promise<PredictionSnapshot[]>;
  putSnapshot(snapshot: PredictionSnapshot): Promise<void>;
  replaceSnapshots(snapshots: readonly PredictionSnapshot[]): Promise<void>;
  getEvaluations(): Promise<PredictionEvaluation[]>;
  putEvaluations(evaluations: readonly PredictionEvaluation[]): Promise<void>;
  replaceEvaluations(
    evaluations: readonly PredictionEvaluation[],
  ): Promise<void>;
  getActiveAlgorithm(): Promise<AlgorithmId | null>;
  setActiveAlgorithm(algorithmId: AlgorithmId): Promise<void>;
  replaceBackup(document: BackupDocument): Promise<void>;
}

export function createLotteryLabStorage(): LotteryLabStorage {
  const databasePromise = openDatabase();

  return {
    initialize: async () => {
      const database = await databasePromise;
      return migrateLegacyStorage(database);
    },
    getDraws: () => getAll<DrawRecord>(databasePromise, DRAW_STORE),
    putDraw: (draw) => putOne(databasePromise, DRAW_STORE, draw),
    putDraws: (draws) => putMany(databasePromise, DRAW_STORE, draws),
    replaceDraws: (draws) => replaceStore(databasePromise, DRAW_STORE, draws),
    getSnapshots: () =>
      getAll<PredictionSnapshot>(databasePromise, SNAPSHOT_STORE),
    putSnapshot: (snapshot) =>
      putOne(databasePromise, SNAPSHOT_STORE, snapshot),
    replaceSnapshots: (snapshots) =>
      replaceStore(databasePromise, SNAPSHOT_STORE, snapshots),
    getEvaluations: () =>
      getAll<PredictionEvaluation>(databasePromise, EVALUATION_STORE),
    putEvaluations: (evaluations) =>
      putMany(databasePromise, EVALUATION_STORE, evaluations),
    replaceEvaluations: (evaluations) =>
      replaceStore(databasePromise, EVALUATION_STORE, evaluations),
    getActiveAlgorithm: () =>
      getMetadata<AlgorithmId>(databasePromise, ACTIVE_ALGORITHM_KEY),
    setActiveAlgorithm: async (algorithmId) => {
      await putOne(databasePromise, METADATA_STORE, {
        key: ACTIVE_ALGORITHM_KEY,
        value: algorithmId,
      });
      writeLegacyActiveAlgorithm(algorithmId);
    },
    replaceBackup: (document) => replaceBackup(databasePromise, document),
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("当前浏览器不支持 IndexedDB。"));
      return;
    }

    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开本地数据库。"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DRAW_STORE))
        database.createObjectStore(DRAW_STORE, { keyPath: "issue" });
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE))
        database.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(EVALUATION_STORE))
        database.createObjectStore(EVALUATION_STORE, { keyPath: "snapshotId" });
      if (!database.objectStoreNames.contains(METADATA_STORE))
        database.createObjectStore(METADATA_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function migrateLegacyStorage(
  database: IDBDatabase,
): Promise<StorageInitializeResult> {
  const migrated = await getMetadataValue<boolean>(
    database,
    LEGACY_MIGRATION_KEY,
  );
  if (migrated) return { migrationWarning: null };

  const legacy = readLegacyStorage();
  if (!legacy.ok) return { migrationWarning: legacy.warning };

  try {
    const transaction = database.transaction(
      [DRAW_STORE, SNAPSHOT_STORE, EVALUATION_STORE, METADATA_STORE],
      "readwrite",
    );
    const draws = transaction.objectStore(DRAW_STORE);
    const snapshots = transaction.objectStore(SNAPSHOT_STORE);
    const evaluations = transaction.objectStore(EVALUATION_STORE);
    const metadata = transaction.objectStore(METADATA_STORE);

    legacy.draws.forEach((draw) => draws.put(draw));
    legacy.review.snapshots.forEach((snapshot) => snapshots.put(snapshot));
    legacy.review.evaluations.forEach((evaluation) =>
      evaluations.put(evaluation),
    );
    if (legacy.activeAlgorithm)
      metadata.put({
        key: ACTIVE_ALGORITHM_KEY,
        value: legacy.activeAlgorithm,
      });
    metadata.put({ key: LEGACY_MIGRATION_KEY, value: true });

    await transactionComplete(transaction);
    return { migrationWarning: null };
  } catch {
    return {
      migrationWarning:
        "旧版本地数据未能迁移到 IndexedDB，旧数据已保留且可在下次启动时重试。",
    };
  }
}

function readLegacyStorage():
  | {
      ok: true;
      draws: Record<string, unknown>[];
      review: LegacyReviewRecord;
      activeAlgorithm: string | null;
    }
  | { ok: false; warning: string } {
  try {
    const drawRaw = window.localStorage.getItem(LEGACY_DRAW_KEY);
    const reviewRaw = window.localStorage.getItem(LEGACY_REVIEW_KEY);
    const activeAlgorithm = window.localStorage.getItem(
      LEGACY_ACTIVE_ALGORITHM_KEY,
    );
    const draws = drawRaw ? JSON.parse(drawRaw) : [];
    const review = reviewRaw
      ? JSON.parse(reviewRaw)
      : { snapshots: [], evaluations: [] };

    if (!Array.isArray(draws) || !isObject(review)) {
      return {
        ok: false,
        warning: "发现旧版本地数据但格式不完整，已保留原数据且未执行迁移。",
      };
    }

    const snapshots = Array.isArray(review.snapshots) ? review.snapshots : null;
    const evaluations = Array.isArray(review.evaluations)
      ? review.evaluations
      : null;
    if (
      !snapshots ||
      !evaluations ||
      !draws.every(isObject) ||
      !snapshots.every(isObject) ||
      !evaluations.every(isObject)
    ) {
      return {
        ok: false,
        warning: "发现旧版本地数据但格式不完整，已保留原数据且未执行迁移。",
      };
    }

    return {
      ok: true,
      draws: draws as Record<string, unknown>[],
      review: { snapshots, evaluations },
      activeAlgorithm,
    };
  } catch {
    return {
      ok: false,
      warning: "读取旧版 localStorage 数据失败，旧数据未被删除。",
    };
  }
}

async function getAll<T>(
  databasePromise: Promise<IDBDatabase>,
  storeName: StoreName,
): Promise<T[]> {
  const database = await databasePromise;
  const transaction = database.transaction(storeName, "readonly");
  const request = transaction.objectStore(storeName).getAll();
  const values = await requestResult(request);
  await transactionComplete(transaction);
  return values as T[];
}

async function putOne(
  databasePromise: Promise<IDBDatabase>,
  storeName: StoreName,
  value: unknown,
): Promise<void> {
  const database = await databasePromise;
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(value);
  await transactionComplete(transaction);
}

async function putMany(
  databasePromise: Promise<IDBDatabase>,
  storeName: StoreName,
  values: readonly unknown[],
): Promise<void> {
  const database = await databasePromise;
  const transaction = database.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  values.forEach((value) => store.put(value));
  await transactionComplete(transaction);
}

async function replaceStore(
  databasePromise: Promise<IDBDatabase>,
  storeName: StoreName,
  values: readonly unknown[],
): Promise<void> {
  const database = await databasePromise;
  const transaction = database.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  store.clear();
  values.forEach((value) => store.put(value));
  await transactionComplete(transaction);
}

async function getMetadata<T>(
  databasePromise: Promise<IDBDatabase>,
  key: string,
): Promise<T | null> {
  const database = await databasePromise;
  return getMetadataValue<T>(database, key);
}

async function getMetadataValue<T>(
  database: IDBDatabase,
  key: string,
): Promise<T | null> {
  const transaction = database.transaction(METADATA_STORE, "readonly");
  const request = transaction.objectStore(METADATA_STORE).get(key);
  const record = (await requestResult(request)) as MetadataRecord | undefined;
  await transactionComplete(transaction);
  return record?.value ? (record.value as T) : null;
}

async function replaceBackup(
  databasePromise: Promise<IDBDatabase>,
  document: BackupDocument,
): Promise<void> {
  const database = await databasePromise;
  const transaction = database.transaction(
    [DRAW_STORE, SNAPSHOT_STORE, EVALUATION_STORE, METADATA_STORE],
    "readwrite",
  );
  const draws = transaction.objectStore(DRAW_STORE);
  const snapshots = transaction.objectStore(SNAPSHOT_STORE);
  const evaluations = transaction.objectStore(EVALUATION_STORE);
  const metadata = transaction.objectStore(METADATA_STORE);

  draws.clear();
  snapshots.clear();
  evaluations.clear();
  document.draws.forEach((draw) => draws.put(draw));
  document.snapshots.forEach((snapshot) => snapshots.put(snapshot));
  document.evaluations.forEach((evaluation) => evaluations.put(evaluation));
  metadata.put({
    key: ACTIVE_ALGORITHM_KEY,
    value: document.activeAlgorithmId,
  });
  metadata.put({ key: LEGACY_MIGRATION_KEY, value: true });

  await transactionComplete(transaction);
  writeLegacyActiveAlgorithm(document.activeAlgorithmId);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("本地数据库请求失败。"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("本地数据库事务失败。"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("本地数据库事务已取消。"));
  });
}

function writeLegacyActiveAlgorithm(algorithmId: AlgorithmId): void {
  try {
    window.localStorage.setItem(LEGACY_ACTIVE_ALGORITHM_KEY, algorithmId);
  } catch {
    // IndexedDB remains the source of truth; compatibility storage is optional.
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
