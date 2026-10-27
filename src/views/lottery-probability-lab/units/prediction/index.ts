import { reactive } from "vue";
import type {
  AlgorithmBacktestMetric,
  AlgorithmDefinition,
  AlgorithmId,
  AuditReport,
  BacktestReport,
  CandidateTier,
  DrawRecord,
  PredictiveAlgorithmId,
  PredictionBatch,
  PredictionError,
  PredictionOperationResult,
  PredictionSnapshot,
  PrizeCoverageGroup,
} from "../../types";
import {
  createAuditReport,
  equalEnsembleWeights,
  generateCombinations,
  generatePrizeCoverageGroups,
  type EnsembleWeights,
} from "./algorithms";

const TRAINING_WINDOW = 160 as const;
const REQUESTED_EVALUATION_PERIODS = 180 as const;
const BACKTEST_VERSION = "backtest-v1" as const;
const PREDICTIVE_ALGORITHMS: readonly PredictiveAlgorithmId[] = [
  "uniform-baseline",
  "bayesian-static",
  "time-decay",
  "pair-dependence",
  "scored-ensemble",
  "coverage-optimizer",
];

interface PeriodOutcome {
  redHitsPerTicket: number;
  blueHitRatePerTicket: number;
  compositeScorePerTicket: number;
}

interface MetricSamples {
  redHits: number[];
  blueRates: number[];
  compositeScores: number[];
  deltas: number[];
}

export interface PredictionState {
  algorithms: readonly AlgorithmDefinition[];
  activeAlgorithmId: AlgorithmId;
  currentBatch: PredictionBatch | null;
  batchesByAlgorithm: Partial<Record<PredictiveAlgorithmId, PredictionBatch>>;
  currentAudit: AuditReport | null;
  backtest: BacktestReport | null;
  isBacktesting: boolean;
  lastOperationMessage: string | null;
}

export interface PredictionUnit {
  readonly state: Readonly<PredictionState>;
  selectAlgorithm(algorithmId: AlgorithmId): void;
  hydrateSnapshots(snapshots: readonly PredictionSnapshot[]): void;
  runBacktest(): Promise<BacktestReport>;
  generate(): Promise<PredictionOperationResult>;
  dispose(): void;
}

const ALGORITHMS: readonly AlgorithmDefinition[] = [
  {
    id: "uniform-baseline",
    name: "均匀组合基准模型",
    shortName: "均匀基准",
    kind: "baseline",
    description: "按双色球规则等概率抽取，用作每种研究模型的冻结滚动回测对照。",
    detail: "每个合法组合在公平零假设下概率相同；三注只保证不重复购买。",
  },
  {
    id: "randomness-audit",
    name: "随机性与均匀性审计",
    shortName: "随机性审计",
    kind: "audit",
    description: "观察号码频率、近期窗口与红球对共现偏离。",
    detail: "审计只提供历史异常证据，不输出购票候选，也不能证明未来可预测。",
  },
  {
    id: "bayesian-static",
    name: "贝叶斯静态偏差模型",
    shortName: "贝叶斯偏差",
    kind: "research",
    description: "以 Beta 收缩后的号码出现率作为无放回抽样权重。",
    detail: "该模型始终输出自身研究候选，并由冻结滚动回测而非热号叙事评估。",
  },
  {
    id: "time-decay",
    name: "时间衰减偏差模型",
    shortName: "时间衰减",
    kind: "research",
    description: "为较新的开奖记录赋予指数衰减权重。",
    detail: "用于检验分布漂移假设，不等同于“遗漏必出”或“近期必热”。",
  },
  {
    id: "pair-dependence",
    name: "红球组合依赖模型",
    shortName: "组合依赖",
    kind: "research",
    description: "把红球对共同出现的平滑分数用于研究候选排序。",
    detail: "号码对数量很多，必须通过时间顺序回测识别可能的过拟合。",
  },
  {
    id: "scored-ensemble",
    name: "滚动评分集成模型",
    shortName: "评分集成",
    kind: "research",
    description: "按此前已完成预测期的相对表现，混合贝叶斯与时间衰减权重。",
    detail:
      "每个历史预测期只使用其之前的表现计算权重，避免把未来信息带回过去。",
  },
  {
    id: "coverage-optimizer",
    name: "三注覆盖优化器",
    shortName: "覆盖优化",
    kind: "portfolio",
    description: "在候选池中优先减少三注间的红球与整注重复。",
    detail: "它实际计算自己的研究候选；降低重叠不改变任意单注理论中奖概率。",
  },
];

export function usePredictionUnit(
  getDraws: () => readonly DrawRecord[],
): PredictionUnit {
  const state = reactive<PredictionState>({
    algorithms: ALGORITHMS,
    activeAlgorithmId: "uniform-baseline",
    currentBatch: null,
    batchesByAlgorithm: {},
    currentAudit: null,
    backtest: null,
    isBacktesting: false,
    lastOperationMessage: null,
  });
  let backtestPromise: Promise<BacktestReport> | null = null;

  const selectAlgorithm = (algorithmId: AlgorithmId) => {
    if (!ALGORITHMS.some((algorithm) => algorithm.id === algorithmId)) return;
    state.activeAlgorithmId = algorithmId;
    state.currentBatch =
      algorithmId === "randomness-audit"
        ? null
        : (state.batchesByAlgorithm[algorithmId] ?? null);
  };

  const hydrateSnapshots = (snapshots: readonly PredictionSnapshot[]) => {
    const latestBatches: Partial<
      Record<PredictiveAlgorithmId, PredictionBatch>
    > = {};
    const ordered = [...snapshots].sort((left, right) =>
      left.recordedAt.localeCompare(right.recordedAt),
    );
    ordered.forEach((snapshot) => {
      latestBatches[snapshot.algorithmId] = clonePredictionBatch(snapshot);
    });
    state.batchesByAlgorithm = latestBatches;
    state.currentBatch =
      state.activeAlgorithmId === "randomness-audit"
        ? null
        : (latestBatches[state.activeAlgorithmId] ?? null);
  };

  const runBacktest = async (): Promise<BacktestReport> => {
    const draws = getDraws();
    const signature = createDataSignature(draws);
    if (state.backtest?.dataSignature === signature) return state.backtest;
    if (backtestPromise) return backtestPromise;

    state.isBacktesting = true;
    const promise = buildBacktestReport(draws, signature)
      .then((report) => {
        if (createDataSignature(getDraws()) === signature) {
          state.backtest = report;
          state.lastOperationMessage = report.evaluationPeriods
            ? `已完成 ${report.evaluationPeriods} 个冻结预测期的滚动回测。`
            : `当前只有 ${draws.length} 期数据；至少 ${TRAINING_WINDOW + 1} 期后才会产生滚动评估期。`;
        }
        return report;
      })
      .finally(() => {
        state.isBacktesting = false;
        backtestPromise = null;
      });
    backtestPromise = promise;
    return promise;
  };

  const generate = async (): Promise<PredictionOperationResult> => {
    const draws = getDraws();
    if (!draws.length)
      return failure(
        "no-draw-data",
        "请等待官方自动同步，或在接口不可用时导入 CSV 数据。",
      );

    if (state.activeAlgorithmId === "randomness-audit") {
      const report = createAuditReport(draws);
      state.currentAudit = report;
      state.lastOperationMessage = "已生成描述性随机性审计报告。";
      return { ok: true, value: report };
    }

    try {
      const algorithmId = state.activeAlgorithmId;
      const backtest = await runBacktest();
      const metric =
        backtest.metrics.find((item) => item.algorithmId === algorithmId) ??
        null;
      const latestDraw = draws[draws.length - 1];
      const seed = fnv1a32(
        `ssq-candidate-v2|${algorithmId}|${latestDraw.issue}|${latestDraw.date}|${backtest.dataSignature}`,
      );
      const candidateTier = metric?.candidateTier ?? "research";
      const validationMessage =
        metric?.validationMessage ??
        "当前数据尚未形成可验证的冻结回测报告；该组号仅作为研究候选。";
      const coverageGroups = generatePrizeCoverageGroups(
        algorithmId,
        draws,
        seed,
        backtest.ensembleWeights,
      ).map((group) => ({
        ...group,
        proofSteps: [
          ...group.proofSteps,
          {
            label: "候选身份",
            value:
              candidateTier === "validated"
                ? "回测通过"
                : candidateTier === "baseline"
                  ? "均匀基准"
                  : "研究候选",
            detail: validationMessage,
          },
          {
            label: "冻结回测摘要",
            value: metric
              ? `${metric.evaluationPeriods} 期 · 分差 ${formatSigned(metric.meanCompositeScoreDelta)}`
              : "尚无评估期",
            detail: metric
              ? `95% 下界 ${formatSigned(metric.compositeScoreDeltaLower95)}；胜率 ${formatPercent(metric.periodWinRate)}。`
              : "数据不足时仍生成当前算法自身的研究覆盖候选。",
          },
        ],
      }));
      const batch: PredictionBatch = {
        id: `prediction-${Date.now()}-${seed}`,
        algorithmId,
        effectiveAlgorithmId: algorithmId,
        candidateTier,
        validationMessage,
        backtestMetric: metric,
        coverageGroups,
        algorithmVersion: "candidate-v3",
        sourceLatestIssue: latestDraw.issue,
        sourceLatestDate: latestDraw.date,
        generatedAt: new Date().toISOString(),
        seed,
        fallbackReason: null,
        combinations: coverageGroups.flatMap((group) => [
          group.firstPrizeAnchor,
          group.secondPrizeBlueCover,
          group.thirdPrizeRedCover,
        ]),
      };
      state.batchesByAlgorithm[algorithmId] = clonePredictionBatch(batch);
      state.currentBatch = state.batchesByAlgorithm[algorithmId] ?? null;
      state.lastOperationMessage =
        batch.candidateTier === "validated"
          ? "已生成回测通过条件下的候选；这仍不是未来中奖保证。"
          : "已生成当前算法的研究候选；冻结回测尚未证明它优于均匀基准。";
      return { ok: true, value: batch };
    } catch {
      return failure(
        "calculation-failure",
        "回测或候选计算失败，请保留当前数据后重试。",
      );
    }
  };

  return {
    state,
    selectAlgorithm,
    hydrateSnapshots,
    runBacktest,
    generate,
    dispose: () => {
      state.currentAudit = null;
      state.currentBatch = null;
      state.lastOperationMessage = null;
    },
  };
}

function clonePredictionBatch(
  batch: PredictionBatch | PredictionSnapshot,
): PredictionBatch {
  return {
    id: batch.id,
    algorithmId: batch.algorithmId,
    effectiveAlgorithmId: batch.effectiveAlgorithmId,
    candidateTier: batch.candidateTier,
    validationMessage: batch.validationMessage,
    backtestMetric: batch.backtestMetric
      ? {
          algorithmId: batch.backtestMetric.algorithmId,
          evaluationPeriods: batch.backtestMetric.evaluationPeriods,
          averageRedHitsPerTicket: batch.backtestMetric.averageRedHitsPerTicket,
          blueHitRatePerTicket: batch.backtestMetric.blueHitRatePerTicket,
          averageCompositeScorePerTicket:
            batch.backtestMetric.averageCompositeScorePerTicket,
          meanCompositeScoreDelta: batch.backtestMetric.meanCompositeScoreDelta,
          compositeScoreDeltaLower95:
            batch.backtestMetric.compositeScoreDeltaLower95,
          periodWinRate: batch.backtestMetric.periodWinRate,
          periodTieRate: batch.backtestMetric.periodTieRate,
          candidateTier: batch.backtestMetric.candidateTier,
          validationMessage: batch.backtestMetric.validationMessage,
        }
      : null,
    coverageGroups: batch.coverageGroups.map(cloneCoverageGroup),
    algorithmVersion: batch.algorithmVersion,
    sourceLatestIssue: batch.sourceLatestIssue,
    sourceLatestDate: batch.sourceLatestDate,
    generatedAt: batch.generatedAt,
    seed: batch.seed,
    fallbackReason: batch.fallbackReason,
    combinations: batch.combinations.map((combination) => ({
      redNumbers: [...combination.redNumbers],
      blueNumber: combination.blueNumber,
      score: combination.score,
    })),
  };
}

function cloneCoverageGroup(group: PrizeCoverageGroup): PrizeCoverageGroup {
  return {
    groupIndex: group.groupIndex,
    firstPrizeAnchor: {
      ...group.firstPrizeAnchor,
      redNumbers: [...group.firstPrizeAnchor.redNumbers],
    },
    secondPrizeBlueCover: {
      ...group.secondPrizeBlueCover,
      redNumbers: [...group.secondPrizeBlueCover.redNumbers],
    },
    thirdPrizeRedCover: {
      ...group.thirdPrizeRedCover,
      redNumbers: [...group.thirdPrizeRedCover.redNumbers],
    },
    proofSteps: group.proofSteps.map((step) => ({
      label: step.label,
      value: step.value,
      detail: step.detail,
    })),
  };
}

async function buildBacktestReport(
  draws: readonly DrawRecord[],
  dataSignature: string,
): Promise<BacktestReport> {
  const evaluationStart = Math.max(
    TRAINING_WINDOW,
    draws.length - REQUESTED_EVALUATION_PERIODS,
  );
  const evaluationPeriods = Math.max(0, draws.length - evaluationStart);
  const samples = new Map<PredictiveAlgorithmId, MetricSamples>(
    PREDICTIVE_ALGORITHMS.map((algorithmId) => [
      algorithmId,
      { redHits: [], blueRates: [], compositeScores: [], deltas: [] },
    ]),
  );
  const priorDeltas = {
    bayesianStatic: [] as number[],
    timeDecay: [] as number[],
  };

  for (
    let targetIndex = evaluationStart;
    targetIndex < draws.length;
    targetIndex += 1
  ) {
    const trainingDraws = draws.slice(
      targetIndex - TRAINING_WINDOW,
      targetIndex,
    );
    const targetDraw = draws[targetIndex];
    const outcomes = new Map<PredictiveAlgorithmId, PeriodOutcome>();

    for (const algorithmId of PREDICTIVE_ALGORITHMS) {
      const ensembleWeights =
        algorithmId === "scored-ensemble"
          ? deriveEnsembleWeights(priorDeltas)
          : undefined;
      const seed = fnv1a32(
        `${BACKTEST_VERSION}|${algorithmId}|${targetDraw.issue}|${targetDraw.date}`,
      );
      outcomes.set(
        algorithmId,
        evaluatePeriod(
          generateCombinations(algorithmId, trainingDraws, seed, {
            ensembleWeights,
          }),
          targetDraw,
        ),
      );
    }

    const baselineScore =
      outcomes.get("uniform-baseline")!.compositeScorePerTicket;
    PREDICTIVE_ALGORITHMS.forEach((algorithmId) => {
      const outcome = outcomes.get(algorithmId)!;
      const metric = samples.get(algorithmId)!;
      metric.redHits.push(outcome.redHitsPerTicket);
      metric.blueRates.push(outcome.blueHitRatePerTicket);
      metric.compositeScores.push(outcome.compositeScorePerTicket);
      if (algorithmId !== "uniform-baseline")
        metric.deltas.push(outcome.compositeScorePerTicket - baselineScore);
    });

    priorDeltas.bayesianStatic.push(
      outcomes.get("bayesian-static")!.compositeScorePerTicket - baselineScore,
    );
    priorDeltas.timeDecay.push(
      outcomes.get("time-decay")!.compositeScorePerTicket - baselineScore,
    );

    if ((targetIndex - evaluationStart + 1) % 8 === 0) await yieldToBrowser();
  }

  const metrics = PREDICTIVE_ALGORITHMS.map((algorithmId) =>
    createMetric(algorithmId, samples.get(algorithmId)!),
  );
  const finalWeights = deriveEnsembleWeights(priorDeltas);

  return {
    algorithmVersion: BACKTEST_VERSION,
    dataSignature,
    trainingWindow: TRAINING_WINDOW,
    requestedEvaluationPeriods: REQUESTED_EVALUATION_PERIODS,
    evaluationPeriods,
    evaluatedFromIssue: evaluationPeriods ? draws[evaluationStart].issue : null,
    evaluatedToIssue: evaluationPeriods ? draws[draws.length - 1].issue : null,
    generatedAt: new Date().toISOString(),
    metrics,
    ensembleWeights: finalWeights,
  };
}

function evaluatePeriod(
  combinations: readonly {
    redNumbers: readonly number[];
    blueNumber: number;
  }[],
  target: DrawRecord,
): PeriodOutcome {
  const ticketOutcomes = combinations.map((combination) => {
    const redHits = combination.redNumbers.filter((number) =>
      target.redNumbers.includes(number),
    ).length;
    const blueHit = combination.blueNumber === target.blueNumber;
    return { redHits, blueHit, composite: redHits + (blueHit ? 0.5 : 0) };
  });
  return {
    redHitsPerTicket: average(ticketOutcomes.map((item) => item.redHits)),
    blueHitRatePerTicket: average(
      ticketOutcomes.map((item) => (item.blueHit ? 1 : 0)),
    ),
    compositeScorePerTicket: average(
      ticketOutcomes.map((item) => item.composite),
    ),
  };
}

function createMetric(
  algorithmId: PredictiveAlgorithmId,
  samples: MetricSamples,
): AlgorithmBacktestMetric {
  const periods = samples.compositeScores.length;
  if (algorithmId === "uniform-baseline") {
    return {
      algorithmId,
      evaluationPeriods: periods,
      averageRedHitsPerTicket: average(samples.redHits),
      blueHitRatePerTicket: average(samples.blueRates),
      averageCompositeScorePerTicket: average(samples.compositeScores),
      meanCompositeScoreDelta: null,
      compositeScoreDeltaLower95: null,
      periodWinRate: null,
      periodTieRate: null,
      candidateTier: "baseline",
      validationMessage:
        "公平零假设对照：用于比较研究模型的历史表现，不以历史拟合主张优势。",
    };
  }

  const meanDelta = average(samples.deltas);
  const lower95 =
    samples.deltas.length >= 2
      ? meanDelta -
        (1.96 * sampleStdDev(samples.deltas)) / Math.sqrt(samples.deltas.length)
      : null;
  const wins = samples.deltas.filter((delta) => delta > 0).length;
  const ties = samples.deltas.filter((delta) => delta === 0).length;
  const candidateTier: CandidateTier =
    periods >= 120 && lower95 !== null && lower95 > 0
      ? "validated"
      : "research";
  const validationMessage =
    candidateTier === "validated"
      ? "冻结滚动回测满足当前门槛；这只是历史条件成立，不代表未来中奖保证。"
      : periods < 120
        ? `仅有 ${periods} 个冻结评估期，少于 120 个门槛；本组号为研究候选。`
        : lower95 === null
          ? "评估期不足以计算稳定差异下界；本组号为研究候选。"
          : `相对均匀基准的 95% 下界为 ${formatSigned(lower95)}，未大于 0；本组号为研究候选。`;

  return {
    algorithmId,
    evaluationPeriods: periods,
    averageRedHitsPerTicket: average(samples.redHits),
    blueHitRatePerTicket: average(samples.blueRates),
    averageCompositeScorePerTicket: average(samples.compositeScores),
    meanCompositeScoreDelta: meanDelta,
    compositeScoreDeltaLower95: lower95,
    periodWinRate: periods ? wins / periods : null,
    periodTieRate: periods ? ties / periods : null,
    candidateTier,
    validationMessage,
  };
}

function deriveEnsembleWeights(deltas: {
  bayesianStatic: readonly number[];
  timeDecay: readonly number[];
}): EnsembleWeights {
  const bayesian = Math.max(0, average(deltas.bayesianStatic));
  const timeDecay = Math.max(0, average(deltas.timeDecay));
  const total = bayesian + timeDecay;
  return total > 0
    ? { bayesianStatic: bayesian / total, timeDecay: timeDecay / total }
    : equalEnsembleWeights();
}

function average(values: readonly number[]): number {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function sampleStdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(
    values.reduce((total, value) => total + Math.pow(value - mean, 2), 0) /
      (values.length - 1),
  );
}

function createDataSignature(draws: readonly DrawRecord[]): string {
  return `fnv1a-${fnv1a32(
    `${BACKTEST_VERSION}|${draws.map((draw) => `${draw.issue}|${draw.date}|${draw.redNumbers.join("-")}|${draw.blueNumber}`).join("\n")}`,
  )
    .toString(16)
    .padStart(8, "0")}`;
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function formatSigned(value: number | null): string {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function failure(
  type: PredictionError["type"],
  message: string,
): PredictionOperationResult {
  return { ok: false, error: { type, message } };
}
