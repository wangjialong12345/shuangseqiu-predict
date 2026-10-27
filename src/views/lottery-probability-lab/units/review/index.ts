import { reactive } from "vue";
import type {
  AlgorithmBacktestMetric,
  CombinationEvaluation,
  CoverageProofStep,
  PrizeCoverageGroup,
  PrizeCoverageTicket,
  PrizeTier,
  DrawRecord,
  LotteryCombination,
  PredictionBatch,
  PredictionEvaluation,
  PredictionSnapshot,
  RestoreResult,
  ReviewError,
  ReviewOperationResult,
  ReviewStatistics,
} from "../../types";
import { LOTTERY_CONSTANTS } from "../../types";
import type { LotteryLabStorage } from "../../storage";
import { compareIssues } from "../draw-data";

export interface ReviewState {
  snapshots: PredictionSnapshot[];
  evaluations: PredictionEvaluation[];
  statistics: ReviewStatistics;
  lastOperationMessage: string | null;
}

export interface ReviewUnit {
  readonly state: Readonly<ReviewState>;
  initialize(): Promise<RestoreResult>;
  recordBatch(batch: PredictionBatch): Promise<ReviewOperationResult>;
  reconcile(draws: readonly DrawRecord[]): Promise<ReviewOperationResult>;
  replaceAll(
    snapshots: readonly PredictionSnapshot[],
    evaluations: readonly PredictionEvaluation[],
  ): Promise<ReviewOperationResult>;
  dispose(): void;
}

export function useReviewUnit(storage: LotteryLabStorage): ReviewUnit {
  const state = reactive<ReviewState>({
    snapshots: [],
    evaluations: [],
    statistics: createStatistics([], []),
    lastOperationMessage: null,
  });
  let writeTail: Promise<void> = Promise.resolve();

  const replaceState = (
    snapshots: readonly PredictionSnapshot[],
    evaluations: readonly PredictionEvaluation[],
  ) => {
    state.snapshots.splice(
      0,
      state.snapshots.length,
      ...snapshots.map(cloneSnapshot),
    );
    state.evaluations.splice(
      0,
      state.evaluations.length,
      ...evaluations.map(cloneEvaluation),
    );
    state.statistics = createStatistics(state.snapshots, state.evaluations);
  };

  const enqueueWrite = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeTail.then(operation, operation);
    writeTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const initialize = async (): Promise<RestoreResult> => {
    try {
      const sourceSnapshots = await storage.getSnapshots();
      const snapshots = sourceSnapshots.filter(isSnapshot).map(cloneSnapshot);
      const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.id));
      const sourceEvaluations = await storage.getEvaluations();
      const evaluations = sourceEvaluations
        .filter((evaluation) => isEvaluation(evaluation, snapshotIds))
        .map(cloneEvaluation);
      replaceState(snapshots, evaluations);
      const rejected =
        sourceSnapshots.length -
        snapshots.length +
        sourceEvaluations.length -
        evaluations.length;
      return {
        restored: snapshots.length,
        warning: rejected
          ? `已忽略 ${rejected} 条损坏的 IndexedDB 预测或对照记录。`
          : null,
      };
    } catch {
      return {
        restored: 0,
        warning: "无法读取 IndexedDB 预测快照，页面将以空账本启动。",
      };
    }
  };

  const recordBatch = async (
    batch: PredictionBatch,
  ): Promise<ReviewOperationResult> => {
    if (!isValidBatch(batch)) return invalidBatchResult();
    const snapshot: PredictionSnapshot = {
      ...cloneBatch(batch),
      recordedAt: new Date().toISOString(),
    };

    try {
      await enqueueWrite(() => storage.putSnapshot(snapshot));
      replaceState([...state.snapshots, snapshot], state.evaluations);
      state.lastOperationMessage =
        "已保存不可变预测快照，等待后续首期开奖对照。";
      return { ok: true, value: snapshot };
    } catch {
      return storageFailureResult();
    }
  };

  const reconcile = async (
    draws: readonly DrawRecord[],
  ): Promise<ReviewOperationResult> => {
    const evaluatedIds = new Set(
      state.evaluations.map((evaluation) => evaluation.snapshotId),
    );
    const newEvaluations: PredictionEvaluation[] = [];

    state.snapshots.forEach((snapshot) => {
      if (evaluatedIds.has(snapshot.id)) return;
      const targetDraw = draws.find((draw) => isAfterSnapshot(draw, snapshot));
      if (!targetDraw) return;
      newEvaluations.push({
        snapshotId: snapshot.id,
        drawIssue: targetDraw.issue,
        drawDate: targetDraw.date,
        results: snapshot.combinations.map((combination) =>
          evaluateCombination(combination, targetDraw),
        ),
      });
    });

    if (!newEvaluations.length) return { ok: true, value: [] };

    try {
      await enqueueWrite(() => storage.putEvaluations(newEvaluations));
      replaceState(state.snapshots, [...state.evaluations, ...newEvaluations]);
      state.lastOperationMessage = `已完成 ${newEvaluations.length} 个预测快照的开奖对照。`;
      return { ok: true, value: newEvaluations };
    } catch {
      return storageFailureResult();
    }
  };

  const replaceAll = async (
    snapshots: readonly PredictionSnapshot[],
    evaluations: readonly PredictionEvaluation[],
  ): Promise<ReviewOperationResult> => {
    if (!snapshots.every(isSnapshot)) return invalidBatchResult();
    const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.id));
    if (
      snapshotIds.size !== snapshots.length ||
      !evaluations.every((evaluation) => isEvaluation(evaluation, snapshotIds))
    ) {
      return invalidBatchResult();
    }

    try {
      await enqueueWrite(async () => {
        await storage.replaceSnapshots(snapshots);
        await storage.replaceEvaluations(evaluations);
      });
      replaceState(snapshots, evaluations);
      state.lastOperationMessage = `已恢复 ${snapshots.length} 个预测快照。`;
      return { ok: true, value: evaluations };
    } catch {
      return storageFailureResult();
    }
  };

  return {
    state,
    initialize,
    recordBatch,
    reconcile,
    replaceAll,
    dispose: () => {
      state.lastOperationMessage = null;
    },
  };
}

export function isSnapshot(value: unknown): value is PredictionSnapshot {
  const candidate = value as PredictionSnapshot;
  return Boolean(
    candidate &&
      typeof candidate.id === "string" &&
      typeof candidate.recordedAt === "string" &&
      isValidBatch(candidate),
  );
}

export function isEvaluation(
  value: unknown,
  snapshotIds: ReadonlySet<string>,
): value is PredictionEvaluation {
  const candidate = value as PredictionEvaluation;
  return Boolean(
    candidate &&
      typeof candidate.snapshotId === "string" &&
      snapshotIds.has(candidate.snapshotId) &&
      typeof candidate.drawIssue === "string" &&
      typeof candidate.drawDate === "string" &&
      Array.isArray(candidate.results) &&
      candidate.results.length === 3 &&
      candidate.results.every(
        (result) =>
          typeof result?.redHitCount === "number" &&
          typeof result?.blueHit === "boolean" &&
          typeof result?.label === "string" &&
          (result?.prizeTier === undefined ||
            result?.prizeTier === null ||
            isPrizeTier(result.prizeTier)),
      ),
  );
}

export function cloneBatch(batch: PredictionBatch): PredictionBatch {
  const candidateTier =
    batch.candidateTier ??
    (batch.algorithmId === "uniform-baseline" ? "baseline" : "research");
  return {
    ...batch,
    candidateTier,
    validationMessage:
      batch.validationMessage ?? "历史快照生成时未提供冻结回测证据。",
    backtestMetric: cloneBacktestMetric(batch.backtestMetric),
    coverageGroups: Array.isArray(batch.coverageGroups)
      ? batch.coverageGroups.map(cloneCoverageGroup)
      : [],
    combinations: batch.combinations.map((combination) => ({
      redNumbers: [...combination.redNumbers],
      blueNumber: combination.blueNumber,
      score: combination.score,
    })),
  };
}

function cloneBacktestMetric(
  metric: AlgorithmBacktestMetric | null,
): AlgorithmBacktestMetric | null {
  if (!metric) return null;
  return {
    algorithmId: metric.algorithmId,
    evaluationPeriods: metric.evaluationPeriods,
    averageRedHitsPerTicket: metric.averageRedHitsPerTicket,
    blueHitRatePerTicket: metric.blueHitRatePerTicket,
    averageCompositeScorePerTicket: metric.averageCompositeScorePerTicket,
    meanCompositeScoreDelta: metric.meanCompositeScoreDelta,
    compositeScoreDeltaLower95: metric.compositeScoreDeltaLower95,
    periodWinRate: metric.periodWinRate,
    periodTieRate: metric.periodTieRate,
    candidateTier: metric.candidateTier,
    validationMessage: metric.validationMessage,
  };
}

function cloneCoverageGroup(group: PrizeCoverageGroup): PrizeCoverageGroup {
  return {
    groupIndex: group.groupIndex,
    firstPrizeAnchor: cloneCoverageTicket(group.firstPrizeAnchor),
    secondPrizeBlueCover: cloneCoverageTicket(group.secondPrizeBlueCover),
    thirdPrizeRedCover: cloneCoverageTicket(group.thirdPrizeRedCover),
    proofSteps: group.proofSteps.map(cloneProofStep),
  };
}

function cloneCoverageTicket(ticket: PrizeCoverageTicket): PrizeCoverageTicket {
  return {
    redNumbers: [...ticket.redNumbers],
    blueNumber: ticket.blueNumber,
    score: ticket.score,
    groupIndex: ticket.groupIndex,
    role: ticket.role,
  };
}

function cloneProofStep(step: CoverageProofStep): CoverageProofStep {
  return { label: step.label, value: step.value, detail: step.detail };
}

export function cloneSnapshot(
  snapshot: PredictionSnapshot,
): PredictionSnapshot {
  return { ...cloneBatch(snapshot), recordedAt: snapshot.recordedAt };
}

export function cloneEvaluation(
  evaluation: PredictionEvaluation,
): PredictionEvaluation {
  return {
    ...evaluation,
    results: evaluation.results.map((result) => ({
      ...result,
      prizeTier:
        result.prizeTier ??
        prizeTierFromHits(result.redHitCount, result.blueHit),
    })),
  };
}

export function evaluateCombination(
  combination: LotteryCombination,
  draw: DrawRecord,
): CombinationEvaluation {
  const redHitCount = combination.redNumbers.filter((number) =>
    draw.redNumbers.includes(number),
  ).length;
  const blueHit = combination.blueNumber === draw.blueNumber;
  return {
    redHitCount,
    blueHit,
    label: `${redHitCount} 红 + ${blueHit ? 1 : 0} 蓝`,
    prizeTier: prizeTierFromHits(redHitCount, blueHit),
  };
}

function prizeTierFromHits(
  redHitCount: number,
  blueHit: boolean,
): PrizeTier | null {
  if (redHitCount === 6 && blueHit) return "一等奖";
  if (redHitCount === 6) return "二等奖";
  if (redHitCount === 5 && blueHit) return "三等奖";
  return null;
}

function isPrizeTier(value: unknown): value is PrizeTier {
  return value === "一等奖" || value === "二等奖" || value === "三等奖";
}

export function isAfterSnapshot(
  draw: DrawRecord,
  snapshot: PredictionSnapshot,
): boolean {
  if (!snapshot.sourceLatestDate) return false;
  const dateOrder = draw.date.localeCompare(snapshot.sourceLatestDate);
  if (dateOrder > 0) return true;
  if (dateOrder < 0 || !snapshot.sourceLatestIssue) return false;
  return compareIssues(draw.issue, snapshot.sourceLatestIssue) > 0;
}

function isValidBatch(batch: PredictionBatch): boolean {
  if (!batch.id || !Array.isArray(batch.combinations)) return false;
  const expectedTicketCount =
    Array.isArray(batch.coverageGroups) && batch.coverageGroups.length ? 15 : 3;
  if (batch.combinations.length !== expectedTicketCount) return false;
  const keys = new Set<string>();
  if (
    !batch.combinations.every((combination) => {
      if (!isValidCombination(combination)) return false;
      const key = `${combination.redNumbers.join("-")}|${combination.blueNumber}`;
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    })
  )
    return false;
  if (!Array.isArray(batch.coverageGroups) || batch.coverageGroups.length === 0)
    return expectedTicketCount === 3;
  if (batch.coverageGroups.length !== 5) return false;
  return batch.coverageGroups.every((group, index) =>
    isValidCoverageGroup(group, index + 1, keys),
  );
}

function isValidCoverageGroup(
  group: PrizeCoverageGroup,
  expectedIndex: number,
  batchKeys: ReadonlySet<string>,
): boolean {
  if (group.groupIndex !== expectedIndex || !Array.isArray(group.proofSteps))
    return false;
  const first = group.firstPrizeAnchor;
  const second = group.secondPrizeBlueCover;
  const third = group.thirdPrizeRedCover;
  if (
    !isValidCoverageTicket(first, expectedIndex, "first-anchor") ||
    !isValidCoverageTicket(second, expectedIndex, "second-blue-cover") ||
    !isValidCoverageTicket(third, expectedIndex, "third-red-cover")
  )
    return false;
  if (
    first.redNumbers.join("-") !== second.redNumbers.join("-") ||
    first.blueNumber === second.blueNumber
  )
    return false;
  if (first.blueNumber !== third.blueNumber) return false;
  const retained = third.redNumbers.filter((number) =>
    first.redNumbers.includes(number),
  ).length;
  if (retained !== 5) return false;
  return [first, second, third].every((ticket) =>
    batchKeys.has(`${ticket.redNumbers.join("-")}|${ticket.blueNumber}`),
  );
}

function isValidCoverageTicket(
  ticket: PrizeCoverageTicket,
  groupIndex: number,
  role: PrizeCoverageTicket["role"],
): boolean {
  return (
    ticket.groupIndex === groupIndex &&
    ticket.role === role &&
    isValidCombination(ticket)
  );
}

function isValidCombination(combination: LotteryCombination): boolean {
  if (combination.redNumbers.length !== LOTTERY_CONSTANTS.redCount)
    return false;
  if (
    combination.blueNumber < 1 ||
    combination.blueNumber > LOTTERY_CONSTANTS.blueMaximum
  )
    return false;
  const numbers = [...combination.redNumbers];
  return (
    new Set(numbers).size === LOTTERY_CONSTANTS.redCount &&
    numbers.every(
      (number) =>
        Number.isInteger(number) &&
        number >= 1 &&
        number <= LOTTERY_CONSTANTS.redMaximum,
    )
  );
}

function invalidBatchResult(): { ok: false; error: ReviewError } {
  return {
    ok: false,
    error: {
      type: "invalid-batch",
      message: "预测快照或对照记录不完整，未保存任何恢复数据。",
    },
  };
}

function storageFailureResult(): { ok: false; error: ReviewError } {
  return {
    ok: false,
    error: {
      type: "storage-failure",
      message: "IndexedDB 未能保存预测快照，请检查浏览器存储权限。",
    },
  };
}

function createStatistics(
  snapshots: readonly PredictionSnapshot[],
  evaluations: readonly PredictionEvaluation[],
): ReviewStatistics {
  const hitDistribution: Record<string, number> = {};
  let blueHitCount = 0;
  let bestRedHitCount = 0;
  let evaluatedTicketCount = 0;

  evaluations.forEach((evaluation) => {
    evaluation.results.forEach((result) => {
      evaluatedTicketCount += 1;
      blueHitCount += result.blueHit ? 1 : 0;
      bestRedHitCount = Math.max(bestRedHitCount, result.redHitCount);
      hitDistribution[result.label] = (hitDistribution[result.label] ?? 0) + 1;
    });
  });

  return {
    singleJackpotProbability: 1 / LOTTERY_CONSTANTS.singleJackpotDenominator,
    threeTicketJackpotProbability:
      3 / LOTTERY_CONSTANTS.singleJackpotDenominator,
    fifteenTicketJackpotProbability:
      15 / LOTTERY_CONSTANTS.singleJackpotDenominator,
    snapshotCount: snapshots.length,
    evaluatedSnapshotCount: evaluations.length,
    evaluatedTicketCount,
    blueHitCount,
    bestRedHitCount,
    hitDistribution,
  };
}
