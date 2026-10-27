export const ALGORITHM_IDS = [
  "uniform-baseline",
  "randomness-audit",
  "bayesian-static",
  "time-decay",
  "pair-dependence",
  "scored-ensemble",
  "coverage-optimizer",
] as const;

export type AlgorithmId = (typeof ALGORITHM_IDS)[number];

export type AlgorithmKind = "baseline" | "audit" | "research" | "portfolio";

export interface AlgorithmDefinition {
  id: AlgorithmId;
  name: string;
  shortName: string;
  kind: AlgorithmKind;
  description: string;
  detail: string;
}

export interface DrawInput {
  issue: string;
  date: string;
  redNumbers: readonly number[];
  blueNumber: number;
}

export interface DrawRecord extends DrawInput {
  redNumbers: readonly number[];
}

export interface BallFrequency {
  number: number;
  count: number;
  rate: number;
}

export interface DrawSummary {
  totalDraws: number;
  latestDraw: DrawRecord | null;
  redFrequencies: readonly BallFrequency[];
  blueFrequencies: readonly BallFrequency[];
}

export type DrawDataError =
  | { type: "invalid-draw"; message: string }
  | { type: "duplicate-issue"; message: string }
  | { type: "storage-failure"; message: string };

export type DrawOperationResult =
  | { ok: true; value: DrawRecord }
  | { ok: false; error: DrawDataError };

export type ReplaceDrawsResult =
  | { ok: true; value: readonly DrawRecord[] }
  | { ok: false; error: DrawDataError };

export interface CsvRejectedRow {
  line: number;
  content: string;
  reason: string;
}

export type ImportDrawCsvResult =
  | {
      ok: true;
      added: readonly DrawRecord[];
      rejected: readonly CsvRejectedRow[];
      message: string;
    }
  | { ok: false; error: DrawDataError };

export interface RestoreResult {
  restored: number;
  warning: string | null;
}

export interface LotteryCombination {
  redNumbers: readonly number[];
  blueNumber: number;
  score: number | null;
}

export type PrizeCoverageRole =
  | "first-anchor"
  | "second-blue-cover"
  | "third-red-cover";

export interface PrizeCoverageTicket extends LotteryCombination {
  groupIndex: number;
  role: PrizeCoverageRole;
}

export interface CoverageProofStep {
  label: string;
  value: string;
  detail: string;
}

export interface PrizeCoverageGroup {
  groupIndex: number;
  firstPrizeAnchor: PrizeCoverageTicket;
  secondPrizeBlueCover: PrizeCoverageTicket;
  thirdPrizeRedCover: PrizeCoverageTicket;
  proofSteps: readonly CoverageProofStep[];
}

export type PrizeTier = "一等奖" | "二等奖" | "三等奖";

export type PredictiveAlgorithmId = Exclude<AlgorithmId, "randomness-audit">;

export type CandidateTier = "baseline" | "research" | "validated";

export interface AlgorithmBacktestMetric {
  algorithmId: PredictiveAlgorithmId;
  evaluationPeriods: number;
  averageRedHitsPerTicket: number;
  blueHitRatePerTicket: number;
  averageCompositeScorePerTicket: number;
  meanCompositeScoreDelta: number | null;
  compositeScoreDeltaLower95: number | null;
  periodWinRate: number | null;
  periodTieRate: number | null;
  candidateTier: CandidateTier;
  validationMessage: string;
}

export interface BacktestReport {
  algorithmVersion: "backtest-v1";
  dataSignature: string;
  trainingWindow: 160;
  requestedEvaluationPeriods: 180;
  evaluationPeriods: number;
  evaluatedFromIssue: string | null;
  evaluatedToIssue: string | null;
  generatedAt: string;
  metrics: readonly AlgorithmBacktestMetric[];
  ensembleWeights: {
    bayesianStatic: number;
    timeDecay: number;
  };
}

export interface PredictionBatch {
  id: string;
  algorithmId: PredictiveAlgorithmId;
  effectiveAlgorithmId: PredictiveAlgorithmId;
  candidateTier: CandidateTier;
  validationMessage: string;
  backtestMetric: AlgorithmBacktestMetric | null;
  coverageGroups: readonly PrizeCoverageGroup[];
  algorithmVersion: string;
  sourceLatestIssue: string | null;
  sourceLatestDate: string | null;
  generatedAt: string;
  seed: number;
  fallbackReason: string | null;
  combinations: readonly LotteryCombination[];
}

export interface AuditMetric {
  label: string;
  value: string;
  description: string;
}

export interface AuditPair {
  first: number;
  second: number;
  count: number;
}

export interface AuditReport {
  generatedAt: string;
  totalDraws: number;
  redChiSquare: number;
  blueChiSquare: number;
  metrics: readonly AuditMetric[];
  recentWindowSize: number;
  recentRedLeaders: readonly BallFrequency[];
  frequentPairs: readonly AuditPair[];
  conclusion: string;
}

export type PredictionError =
  | { type: "no-draw-data"; message: string }
  | { type: "calculation-failure"; message: string };

export type PredictionOperationResult =
  | { ok: true; value: PredictionBatch | AuditReport }
  | { ok: false; error: PredictionError };

export interface PredictionSnapshot extends PredictionBatch {
  recordedAt: string;
}

export interface CombinationEvaluation {
  redHitCount: number;
  blueHit: boolean;
  label: string;
  prizeTier: PrizeTier | null;
}

export interface PredictionEvaluation {
  snapshotId: string;
  drawIssue: string;
  drawDate: string;
  results: readonly CombinationEvaluation[];
}

export interface ReviewStatistics {
  singleJackpotProbability: number;
  threeTicketJackpotProbability: number;
  fifteenTicketJackpotProbability: number;
  snapshotCount: number;
  evaluatedSnapshotCount: number;
  evaluatedTicketCount: number;
  blueHitCount: number;
  bestRedHitCount: number;
  hitDistribution: Readonly<Record<string, number>>;
}

export type ReviewError =
  | { type: "storage-failure"; message: string }
  | { type: "invalid-batch"; message: string };

export type ReviewOperationResult =
  | { ok: true; value: PredictionSnapshot | readonly PredictionEvaluation[] }
  | { ok: false; error: ReviewError };

export interface BackupDocument {
  format: "shuangseqiu-probability-lab-backup";
  version: 1;
  exportedAt: string;
  activeAlgorithmId: AlgorithmId;
  draws: readonly DrawRecord[];
  snapshots: readonly PredictionSnapshot[];
  evaluations: readonly PredictionEvaluation[];
}

export type BackupError =
  | { type: "invalid-backup"; message: string }
  | { type: "storage-failure"; message: string };

export type BackupExportResult =
  | { ok: true; value: BackupDocument }
  | { ok: false; error: BackupError };

export type BackupImportResult =
  | { ok: true; value: BackupDocument }
  | { ok: false; error: BackupError };

export const LOTTERY_CONSTANTS = {
  redCount: 6,
  redMaximum: 33,
  blueMaximum: 16,
  minimumResearchDraws: 30,
  singleJackpotDenominator: 17_721_088,
} as const;

export function isAlgorithmId(value: unknown): value is AlgorithmId {
  return (
    typeof value === "string" &&
    (ALGORITHM_IDS as readonly string[]).includes(value)
  );
}

export interface AutomaticOfficialSyncStatus {
  phase:
    | "idle"
    | "bootstrapping"
    | "scheduled"
    | "syncing"
    | "retrying"
    | "error";
  nextSyncAt: string | null;
  scheduledDrawDate: string | null;
  lastSyncedAt: string | null;
  attempt: number;
  message: string | null;
}

export interface OfficialHistorySyncProgress {
  status: "idle" | "syncing";
  currentPage: number;
  pageTotal: number | null;
  collectedCount: number;
}

export type OfficialHistorySyncResult =
  | {
      ok: true;
      added: readonly DrawRecord[];
      skippedExisting: number;
      skippedInvalid: number;
      pageTotal: number;
    }
  | { ok: false; error: { type: "official-sync-failure"; message: string } };
