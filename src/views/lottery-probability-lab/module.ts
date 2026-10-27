import { reactive } from "vue";
import type {
  AlgorithmId,
  AutomaticOfficialSyncStatus,
  BacktestReport,
  BackupDocument,
  BackupError,
  BackupExportResult,
  BackupImportResult,
  AlgorithmBacktestMetric,
  CandidateTier,
  CombinationEvaluation,
  CoverageProofStep,
  DrawRecord,
  PrizeCoverageGroup,
  PrizeCoverageTicket,
  PredictiveAlgorithmId,
  ImportDrawCsvResult,
  LotteryCombination,
  OfficialHistorySyncResult,
  PredictionBatch,
  PredictionEvaluation,
  PredictionOperationResult,
  PredictionSnapshot,
} from "./types";
import { isAlgorithmId, LOTTERY_CONSTANTS } from "./types";
import { createLotteryLabStorage } from "./storage";
import {
  compareIssues,
  normaliseDraw,
  sortDraws,
  useDrawDataUnit,
  type DrawDataUnit,
} from "./units/draw-data";
import {
  cloneEvaluation,
  cloneSnapshot,
  evaluateCombination,
  isAfterSnapshot,
  useReviewUnit,
  type ReviewUnit,
} from "./units/review";
import { usePredictionUnit, type PredictionUnit } from "./units/prediction";

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const SHANGHAI_OFFSET_HOURS = 8;
const DRAW_WEEKDAYS = new Set([0, 2, 4]);
const AUTO_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const AUTO_RETRY_WINDOW_MS = 60 * 60 * 1000;

interface ScheduledOfficialSync {
  timestamp: number;
  drawDate: string;
}

export interface LotteryProbabilityLabViewState {
  activeAlgorithmId: AlgorithmId;
  restoreWarning: string | null;
  automaticSync: AutomaticOfficialSyncStatus;
}

export interface LotteryProbabilityLabViewModule {
  readonly state: Readonly<LotteryProbabilityLabViewState>;
  readonly drawData: DrawDataUnit;
  readonly prediction: PredictionUnit;
  readonly review: ReviewUnit;
  selectAlgorithm(algorithmId: AlgorithmId): void;
  importDrawCsv(csvText: string): Promise<ImportDrawCsvResult>;
  syncOfficialHistory(): Promise<OfficialHistorySyncResult>;
  syncLatestOfficialDraws(): Promise<OfficialHistorySyncResult>;
  generatePrediction(): Promise<PredictionOperationResult>;
  runRollingBacktest(): Promise<BacktestReport>;
  exportBackup(): Promise<BackupExportResult>;
  importBackup(jsonText: string): Promise<BackupImportResult>;
  initialize(): Promise<void>;
  dispose(): void;
}

export function useLotteryProbabilityLabViewModule(): LotteryProbabilityLabViewModule {
  const state = reactive<LotteryProbabilityLabViewState>({
    activeAlgorithmId: "uniform-baseline",
    restoreWarning: null,
    automaticSync: {
      phase: "idle",
      nextSyncAt: null,
      scheduledDrawDate: null,
      lastSyncedAt: null,
      attempt: 0,
      message: "等待页面初始化。",
    },
  });
  const storage = createLotteryLabStorage();
  const drawData = useDrawDataUnit(storage);
  const prediction = usePredictionUnit(() => drawData.state.draws);
  const review = useReviewUnit(storage);
  let scheduledTimer: number | null = null;
  let retryTimer: number | null = null;
  let isDisposed = false;

  const clearTimers = () => {
    if (scheduledTimer !== null) globalThis.clearTimeout(scheduledTimer);
    if (retryTimer !== null) globalThis.clearTimeout(retryTimer);
    scheduledTimer = null;
    retryTimer = null;
  };

  const restorePredictionWorkspace = () => {
    prediction.hydrateSnapshots(review.state.snapshots);
  };

  const applyAlgorithm = (algorithmId: AlgorithmId) => {
    prediction.selectAlgorithm(algorithmId);
    state.activeAlgorithmId = prediction.state.activeAlgorithmId;
  };

  const selectAlgorithm = (algorithmId: AlgorithmId) => {
    applyAlgorithm(algorithmId);
    void storage.setActiveAlgorithm(state.activeAlgorithmId).catch(() => {
      state.restoreWarning = "当前算法已切换，但 IndexedDB 未能保存该选择。";
    });
  };

  const reconcile = async () => {
    const result = await review.reconcile(drawData.state.draws);
    if (!result.ok) state.restoreWarning = result.error.message;
  };

  const importDrawCsv = async (
    csvText: string,
  ): Promise<ImportDrawCsvResult> => {
    const result = await drawData.importCsv(csvText);
    if (result.ok && result.added.length) await reconcile();
    return result;
  };

  const syncOfficialHistory = async (): Promise<OfficialHistorySyncResult> => {
    const result = await drawData.syncOfficialHistory();
    if (result.ok && result.added.length) await reconcile();
    return result;
  };

  const syncLatestOfficialDraws =
    async (): Promise<OfficialHistorySyncResult> => {
      const result = await drawData.syncLatestOfficialDraws();
      if (result.ok && result.added.length) await reconcile();
      return result;
    };

  const scheduleNextAutoSync = () => {
    if (isDisposed) return;
    clearTimers();
    const next = getNextShanghaiDrawSync();
    state.automaticSync = {
      phase: "scheduled",
      nextSyncAt: new Date(next.timestamp).toISOString(),
      scheduledDrawDate: next.drawDate,
      lastSyncedAt: state.automaticSync.lastSyncedAt,
      attempt: 0,
      message:
        "页面开启期间会在北京时间开奖日 21:30 自动同步；重新打开页面会补拉最新开奖。",
    };
    scheduledTimer = globalThis.setTimeout(
      () => {
        void runScheduledSync(next, 0);
      },
      Math.max(0, next.timestamp - Date.now()),
    ) as unknown as number;
  };

  const runScheduledSync = async (
    scheduled: ScheduledOfficialSync,
    attempt: number,
  ) => {
    if (isDisposed) return;
    state.automaticSync = {
      phase: attempt ? "retrying" : "syncing",
      nextSyncAt: new Date(scheduled.timestamp).toISOString(),
      scheduledDrawDate: scheduled.drawDate,
      lastSyncedAt: state.automaticSync.lastSyncedAt,
      attempt,
      message: attempt
        ? `官方结果可能尚未发布，正在第 ${attempt + 1} 次补拉。`
        : "正在自动补拉官方最新开奖结果。",
    };

    const result = await syncLatestOfficialDraws();
    const hasExpectedResult =
      (drawData.state.summary.latestDraw?.date ?? "") >= scheduled.drawDate;
    if (result.ok && hasExpectedResult) {
      state.automaticSync.lastSyncedAt = new Date().toISOString();
      state.automaticSync.message = `已同步第 ${drawData.state.summary.latestDraw?.issue ?? "—"} 期并完成可用预测对照。`;
      scheduleNextAutoSync();
      return;
    }

    const retryUntil = scheduled.timestamp + AUTO_RETRY_WINDOW_MS;
    if (Date.now() + AUTO_RETRY_INTERVAL_MS <= retryUntil) {
      retryTimer = globalThis.setTimeout(() => {
        void runScheduledSync(scheduled, attempt + 1);
      }, AUTO_RETRY_INTERVAL_MS) as unknown as number;
      return;
    }

    state.automaticSync.phase = "error";
    state.automaticSync.message = result.ok
      ? "官方开奖结果在自动补拉窗口内尚未出现；下次打开页面会继续补拉。"
      : result.error.message;
    scheduleNextAutoSync();
  };

  const runStartupSync = async () => {
    if (isDisposed || drawData.state.officialSync.status === "syncing") return;
    const isFirstBootstrap = drawData.state.draws.length === 0;
    state.automaticSync = {
      phase: isFirstBootstrap ? "bootstrapping" : "syncing",
      nextSyncAt: state.automaticSync.nextSyncAt,
      scheduledDrawDate: state.automaticSync.scheduledDrawDate,
      lastSyncedAt: state.automaticSync.lastSyncedAt,
      attempt: 0,
      message: isFirstBootstrap
        ? "首次使用：正在自动同步官方全部历史开奖。"
        : "正在补拉官方最新开奖。",
    };
    const result = isFirstBootstrap
      ? await syncOfficialHistory()
      : await syncLatestOfficialDraws();
    if (result.ok) {
      state.automaticSync.lastSyncedAt = new Date().toISOString();
      state.automaticSync.message = isFirstBootstrap
        ? `首次历史同步完成：新增 ${result.added.length} 期。`
        : result.added.length
          ? `已补拉 ${result.added.length} 期官方最新开奖并完成对照。`
          : "本地已包含官方最新开奖。";
    } else {
      state.automaticSync.phase = "error";
      state.automaticSync.message = result.error.message;
    }
    scheduleNextAutoSync();
  };

  const handleVisibilityChange = () => {
    if (
      typeof document === "undefined" ||
      document.visibilityState !== "visible" ||
      isDisposed
    )
      return;
    void runStartupSync();
  };

  const runRollingBacktest = async (): Promise<BacktestReport> => {
    return prediction.runBacktest();
  };

  const generatePrediction = async (): Promise<PredictionOperationResult> => {
    const result = await prediction.generate();
    if (!result.ok || !("combinations" in result.value)) return result;

    const persisted = await review.recordBatch(result.value as PredictionBatch);
    if (!persisted.ok) {
      return {
        ok: false,
        error: {
          type: "calculation-failure",
          message: persisted.error.message,
        },
      };
    }
    return result;
  };

  const exportBackup = async (): Promise<BackupExportResult> => {
    try {
      return {
        ok: true,
        value: {
          format: "shuangseqiu-probability-lab-backup",
          version: 1,
          exportedAt: new Date().toISOString(),
          activeAlgorithmId: state.activeAlgorithmId,
          draws: drawData.state.draws.map((draw) => ({
            ...draw,
            redNumbers: [...draw.redNumbers],
          })),
          snapshots: review.state.snapshots.map(cloneSnapshot),
          evaluations: review.state.evaluations.map(cloneEvaluation),
        },
      };
    } catch {
      return backupStorageFailure("无法从 IndexedDB 读取完整备份。");
    }
  };

  const importBackup = async (
    jsonText: string,
  ): Promise<BackupImportResult> => {
    const parsed = parseBackupDocument(jsonText);
    if (!parsed.ok) return parsed;

    try {
      await storage.replaceBackup(parsed.value);
      await drawData.initialize();
      await review.initialize();
      restorePredictionWorkspace();
      applyAlgorithm(parsed.value.activeAlgorithmId);
      await reconcile();
      scheduleNextAutoSync();
      return { ok: true, value: parsed.value };
    } catch {
      return backupStorageFailure(
        "备份校验通过，但 IndexedDB 未能完成原子恢复；原有数据未被部分覆盖。",
      );
    }
  };

  const initialize = async () => {
    try {
      const storageResult = await storage.initialize();
      const [drawRestore, reviewRestore] = await Promise.all([
        drawData.initialize(),
        review.initialize(),
      ]);
      restorePredictionWorkspace();
      const storedAlgorithm = await storage.getActiveAlgorithm();
      if (storedAlgorithm && isAlgorithmId(storedAlgorithm))
        applyAlgorithm(storedAlgorithm);

      const warnings = [
        storageResult.migrationWarning,
        drawRestore.warning,
        reviewRestore.warning,
      ].filter((warning): warning is string => Boolean(warning));
      state.restoreWarning = warnings.length ? warnings.join(" ") : null;
      await reconcile();
      if (typeof document !== "undefined")
        if (typeof document !== "undefined")
          document.addEventListener("visibilitychange", handleVisibilityChange);
      void runStartupSync();
    } catch {
      state.restoreWarning =
        "无法打开 IndexedDB。请确认浏览器未处于受限存储模式后刷新页面。";
    }
  };

  return {
    state,
    drawData,
    prediction,
    review,
    selectAlgorithm,
    importDrawCsv,
    syncOfficialHistory,
    syncLatestOfficialDraws,
    generatePrediction,
    runRollingBacktest,
    exportBackup,
    importBackup,
    initialize,
    dispose: () => {
      isDisposed = true;
      clearTimers();
      if (typeof document !== "undefined")
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      drawData.dispose();
      prediction.dispose();
      review.dispose();
    },
  };
}

export function getNextShanghaiDrawSync(
  now = new Date(),
): ScheduledOfficialSync {
  const current = getShanghaiCalendar(now);
  const today = new Date(
    Date.UTC(current.year, current.month - 1, current.day),
  );
  for (let offset = 0; offset < 8; offset += 1) {
    const candidateDay = new Date(today.getTime() + offset * 86_400_000);
    if (!DRAW_WEEKDAYS.has(candidateDay.getUTCDay())) continue;
    const candidateTimestamp = Date.UTC(
      candidateDay.getUTCFullYear(),
      candidateDay.getUTCMonth(),
      candidateDay.getUTCDate(),
      21 - SHANGHAI_OFFSET_HOURS,
      30,
      0,
    );
    if (candidateTimestamp > now.getTime()) {
      return {
        timestamp: candidateTimestamp,
        drawDate: formatPseudoDate(candidateDay),
      };
    }
  }
  throw new Error("无法计算下一次双色球自动同步时间。");
}

function getShanghaiCalendar(now: Date): {
  year: number;
  month: number;
  day: number;
} {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: string) =>
    Number(values.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day") };
}

function formatPseudoDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseBackupDocument(jsonText: string): BackupImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return invalidBackup("备份文件不是有效 JSON。");
  }

  if (
    !isObject(raw) ||
    raw.format !== "shuangseqiu-probability-lab-backup" ||
    raw.version !== 1
  ) {
    return invalidBackup("备份格式或版本不受支持。");
  }
  if (
    typeof raw.exportedAt !== "string" ||
    !isAlgorithmId(raw.activeAlgorithmId)
  ) {
    return invalidBackup("备份缺少有效的导出时间或算法选择。");
  }
  if (
    !Array.isArray(raw.draws) ||
    !Array.isArray(raw.snapshots) ||
    !Array.isArray(raw.evaluations)
  ) {
    return invalidBackup("备份缺少开奖记录、预测快照或对照记录。");
  }

  const draws: DrawRecord[] = [];
  const issues = new Set<string>();
  for (const item of raw.draws) {
    const draw = normaliseDraw(item as DrawRecord);
    if (!draw || issues.has(draw.issue))
      return invalidBackup("备份包含非法或重复期号的开奖记录。");
    issues.add(draw.issue);
    draws.push(draw);
  }
  const sortedDraws = sortDraws(draws);

  const snapshots: PredictionSnapshot[] = [];
  const snapshotIds = new Set<string>();
  for (const item of raw.snapshots) {
    const snapshot = normaliseSnapshot(item);
    if (!snapshot || snapshotIds.has(snapshot.id))
      return invalidBackup("备份包含不完整、非法或重复的预测快照。");
    if (
      !sortedDraws.some(
        (draw) =>
          draw.issue === snapshot.sourceLatestIssue &&
          draw.date === snapshot.sourceLatestDate,
      )
    ) {
      return invalidBackup("预测快照的数据截止期未在备份开奖记录中找到。");
    }
    snapshotIds.add(snapshot.id);
    snapshots.push(snapshot);
  }

  const evaluations: PredictionEvaluation[] = [];
  const evaluatedIds = new Set<string>();
  for (const item of raw.evaluations) {
    const evaluation = normaliseEvaluation(item, snapshots, sortedDraws);
    if (!evaluation || evaluatedIds.has(evaluation.snapshotId)) {
      return invalidBackup("备份包含无效、重复或与开奖不一致的复盘结果。");
    }
    evaluatedIds.add(evaluation.snapshotId);
    evaluations.push(evaluation);
  }

  return {
    ok: true,
    value: {
      format: "shuangseqiu-probability-lab-backup",
      version: 1,
      exportedAt: raw.exportedAt,
      activeAlgorithmId: raw.activeAlgorithmId,
      draws: sortedDraws,
      snapshots,
      evaluations,
    },
  };
}

function normaliseSnapshot(value: unknown): PredictionSnapshot | null {
  if (!isObject(value)) return null;
  if (
    typeof value.id !== "string" ||
    !isPredictiveAlgorithmId(value.algorithmId) ||
    !isPredictiveAlgorithmId(value.effectiveAlgorithmId) ||
    typeof value.algorithmVersion !== "string" ||
    typeof value.sourceLatestIssue !== "string" ||
    typeof value.sourceLatestDate !== "string" ||
    typeof value.generatedAt !== "string" ||
    typeof value.recordedAt !== "string" ||
    typeof value.seed !== "number" ||
    !Array.isArray(value.combinations)
  ) {
    return null;
  }

  const combinations = value.combinations.map(normaliseCombination);
  if (
    combinations.some((combination): combination is null => !combination) ||
    ![3, 15].includes(combinations.length)
  )
    return null;
  const candidateCombinations = combinations as LotteryCombination[];
  const keys = new Set(
    candidateCombinations.map(
      (combination) =>
        `${combination.redNumbers.join("-")}|${combination.blueNumber}`,
    ),
  );
  if (keys.size !== candidateCombinations.length) return null;
  const coverageGroups = normaliseCoverageGroups(value.coverageGroups);
  if (candidateCombinations.length === 15 && coverageGroups.length !== 5)
    return null;

  return {
    id: value.id,
    algorithmId: value.algorithmId,
    effectiveAlgorithmId: value.effectiveAlgorithmId,
    candidateTier: normaliseCandidateTier(value.candidateTier),
    validationMessage:
      typeof value.validationMessage === "string"
        ? value.validationMessage
        : "历史快照生成时未提供冻结回测证据。",
    backtestMetric: normaliseBacktestMetric(
      value.backtestMetric,
      value.algorithmId,
    ),
    coverageGroups,
    algorithmVersion: value.algorithmVersion,
    sourceLatestIssue: value.sourceLatestIssue,
    sourceLatestDate: value.sourceLatestDate,
    generatedAt: value.generatedAt,
    recordedAt: value.recordedAt,
    seed: value.seed,
    fallbackReason:
      typeof value.fallbackReason === "string" ? value.fallbackReason : null,
    combinations: candidateCombinations,
  };
}

function isPredictiveAlgorithmId(
  value: unknown,
): value is PredictiveAlgorithmId {
  return isAlgorithmId(value) && value !== "randomness-audit";
}

function normaliseCandidateTier(value: unknown): CandidateTier {
  return value === "baseline" || value === "validated" || value === "research"
    ? value
    : "research";
}

function normaliseBacktestMetric(
  value: unknown,
  expectedAlgorithmId: PredictiveAlgorithmId,
): AlgorithmBacktestMetric | null {
  if (!isObject(value) || value.algorithmId !== expectedAlgorithmId)
    return null;
  if (
    typeof value.evaluationPeriods !== "number" ||
    typeof value.averageRedHitsPerTicket !== "number" ||
    typeof value.blueHitRatePerTicket !== "number" ||
    typeof value.averageCompositeScorePerTicket !== "number" ||
    (value.meanCompositeScoreDelta !== null &&
      typeof value.meanCompositeScoreDelta !== "number") ||
    (value.compositeScoreDeltaLower95 !== null &&
      typeof value.compositeScoreDeltaLower95 !== "number") ||
    (value.periodWinRate !== null && typeof value.periodWinRate !== "number") ||
    (value.periodTieRate !== null && typeof value.periodTieRate !== "number") ||
    typeof value.validationMessage !== "string"
  ) {
    return null;
  }
  return {
    algorithmId: expectedAlgorithmId,
    evaluationPeriods: value.evaluationPeriods,
    averageRedHitsPerTicket: value.averageRedHitsPerTicket,
    blueHitRatePerTicket: value.blueHitRatePerTicket,
    averageCompositeScorePerTicket: value.averageCompositeScorePerTicket,
    meanCompositeScoreDelta: value.meanCompositeScoreDelta as number | null,
    compositeScoreDeltaLower95: value.compositeScoreDeltaLower95 as
      | number
      | null,
    periodWinRate: value.periodWinRate as number | null,
    periodTieRate: value.periodTieRate as number | null,
    candidateTier: normaliseCandidateTier(value.candidateTier),
    validationMessage: value.validationMessage,
  };
}

function normaliseCoverageGroups(value: unknown): PrizeCoverageGroup[] {
  if (!Array.isArray(value)) return [];
  const groups: PrizeCoverageGroup[] = [];
  for (const candidate of value) {
    if (!isObject(candidate) || typeof candidate.groupIndex !== "number")
      return [];
    const firstPrizeAnchor = normaliseCoverageTicket(
      candidate.firstPrizeAnchor,
      candidate.groupIndex,
      "first-anchor",
    );
    const secondPrizeBlueCover = normaliseCoverageTicket(
      candidate.secondPrizeBlueCover,
      candidate.groupIndex,
      "second-blue-cover",
    );
    const thirdPrizeRedCover = normaliseCoverageTicket(
      candidate.thirdPrizeRedCover,
      candidate.groupIndex,
      "third-red-cover",
    );
    if (
      !firstPrizeAnchor ||
      !secondPrizeBlueCover ||
      !thirdPrizeRedCover ||
      !Array.isArray(candidate.proofSteps)
    )
      return [];
    const proofSteps = candidate.proofSteps.map(normaliseProofStep);
    if (proofSteps.some((step): step is null => !step)) return [];
    groups.push({
      groupIndex: candidate.groupIndex,
      firstPrizeAnchor,
      secondPrizeBlueCover,
      thirdPrizeRedCover,
      proofSteps: proofSteps as CoverageProofStep[],
    });
  }
  return groups;
}

function normaliseCoverageTicket(
  value: unknown,
  groupIndex: number,
  role: PrizeCoverageTicket["role"],
): PrizeCoverageTicket | null {
  if (
    !isObject(value) ||
    value.groupIndex !== groupIndex ||
    value.role !== role
  )
    return null;
  const combination = normaliseCombination(value);
  return combination ? { ...combination, groupIndex, role } : null;
}

function normaliseProofStep(value: unknown): CoverageProofStep | null {
  return isObject(value) &&
    typeof value.label === "string" &&
    typeof value.value === "string" &&
    typeof value.detail === "string"
    ? { label: value.label, value: value.value, detail: value.detail }
    : null;
}

function normaliseCombination(value: unknown): LotteryCombination | null {
  if (
    !isObject(value) ||
    !Array.isArray(value.redNumbers) ||
    typeof value.blueNumber !== "number"
  )
    return null;
  if (value.score !== null && typeof value.score !== "number") return null;
  const redNumbers = value.redNumbers.map(Number);
  const blueNumber = Number(value.blueNumber);
  if (
    redNumbers.length !== LOTTERY_CONSTANTS.redCount ||
    new Set(redNumbers).size !== LOTTERY_CONSTANTS.redCount ||
    redNumbers.some(
      (number) =>
        !Number.isInteger(number) ||
        number < 1 ||
        number > LOTTERY_CONSTANTS.redMaximum,
    ) ||
    redNumbers.some(
      (number, index) => index > 0 && redNumbers[index - 1] >= number,
    ) ||
    !Number.isInteger(blueNumber) ||
    blueNumber < 1 ||
    blueNumber > LOTTERY_CONSTANTS.blueMaximum
  ) {
    return null;
  }
  return { redNumbers, blueNumber, score: value.score as number | null };
}

function normaliseEvaluation(
  value: unknown,
  snapshots: readonly PredictionSnapshot[],
  draws: readonly DrawRecord[],
): PredictionEvaluation | null {
  if (
    !isObject(value) ||
    typeof value.snapshotId !== "string" ||
    typeof value.drawIssue !== "string" ||
    typeof value.drawDate !== "string" ||
    !Array.isArray(value.results)
  ) {
    return null;
  }
  const snapshot = snapshots.find(
    (candidate) => candidate.id === value.snapshotId,
  );
  const targetDraw = draws.find(
    (draw) => draw.issue === value.drawIssue && draw.date === value.drawDate,
  );
  if (
    !snapshot ||
    !targetDraw ||
    value.results.length !== snapshot.combinations.length
  )
    return null;
  const firstLaterDraw = draws.find((draw) => isAfterSnapshot(draw, snapshot));
  if (
    !firstLaterDraw ||
    firstLaterDraw.issue !== targetDraw.issue ||
    firstLaterDraw.date !== targetDraw.date
  )
    return null;

  const expected = snapshot.combinations.map((combination) =>
    evaluateCombination(combination, targetDraw),
  );
  const valid = value.results.every((result, index) =>
    isSameEvaluationResult(result, expected[index]),
  );
  return valid
    ? {
        snapshotId: value.snapshotId,
        drawIssue: value.drawIssue,
        drawDate: value.drawDate,
        results: expected,
      }
    : null;
}

function isSameEvaluationResult(
  value: unknown,
  expected: CombinationEvaluation,
): boolean {
  return (
    isObject(value) &&
    value.redHitCount === expected.redHitCount &&
    value.blueHit === expected.blueHit &&
    value.label === expected.label
  );
}

function invalidBackup(message: string): { ok: false; error: BackupError } {
  return { ok: false, error: { type: "invalid-backup", message } };
}

function backupStorageFailure(message: string): {
  ok: false;
  error: BackupError;
} {
  return { ok: false, error: { type: "storage-failure", message } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
