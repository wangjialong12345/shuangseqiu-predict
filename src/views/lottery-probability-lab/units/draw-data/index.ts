import { reactive } from "vue";
import type {
  BallFrequency,
  CsvRejectedRow,
  DrawDataError,
  DrawInput,
  DrawOperationResult,
  DrawRecord,
  DrawSummary,
  ImportDrawCsvResult,
  OfficialHistorySyncProgress,
  OfficialHistorySyncResult,
  ReplaceDrawsResult,
  RestoreResult,
} from "../../types";
import { LOTTERY_CONSTANTS } from "../../types";
import {
  fetchOfficialHistory,
  fetchOfficialLatestDraws,
  type OfficialDrawNotice,
  type OfficialHistoryResponse,
} from "../../api/official-history";
import type { LotteryLabStorage } from "../../storage";

const CSV_HEADERS = [
  "issue",
  "date",
  "red1",
  "red2",
  "red3",
  "red4",
  "red5",
  "red6",
  "blue",
];

export interface DrawDataState {
  draws: DrawRecord[];
  summary: DrawSummary;
  officialSync: OfficialHistorySyncProgress;
  lastOperationMessage: string | null;
}

export interface DrawDataUnit {
  readonly state: Readonly<DrawDataState>;
  initialize(): Promise<RestoreResult>;
  saveDraw(input: DrawInput): Promise<DrawOperationResult>;
  importCsv(csvText: string): Promise<ImportDrawCsvResult>;
  syncOfficialHistory(): Promise<OfficialHistorySyncResult>;
  syncLatestOfficialDraws(): Promise<OfficialHistorySyncResult>;
  replaceAll(draws: readonly DrawRecord[]): Promise<ReplaceDrawsResult>;
  dispose(): void;
}

export function useDrawDataUnit(storage: LotteryLabStorage): DrawDataUnit {
  const state = reactive<DrawDataState>({
    draws: [],
    summary: createSummary([]),
    officialSync: {
      status: "idle",
      currentPage: 0,
      pageTotal: null,
      collectedCount: 0,
    },
    lastOperationMessage: null,
  });
  let writeTail: Promise<void> = Promise.resolve();

  const replaceState = (draws: readonly DrawRecord[]) => {
    state.draws.splice(0, state.draws.length, ...sortDraws(draws));
    state.summary = createSummary(state.draws);
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
      const restored: DrawRecord[] = [];
      const issues = new Set<string>();
      let rejectedCount = 0;
      for (const candidate of await storage.getDraws()) {
        const normalised = normaliseDraw(candidate);
        if (!normalised || issues.has(normalised.issue)) {
          rejectedCount += 1;
          continue;
        }
        issues.add(normalised.issue);
        restored.push(normalised);
      }
      replaceState(restored);
      return {
        restored: restored.length,
        warning: rejectedCount
          ? `已忽略 ${rejectedCount} 条损坏或重复的 IndexedDB 开奖记录。`
          : null,
      };
    } catch {
      return {
        restored: 0,
        warning: "无法读取 IndexedDB 开奖记录，页面将以空数据启动。",
      };
    }
  };

  const saveDraw = async (input: DrawInput): Promise<DrawOperationResult> => {
    const normalised = normaliseDraw(input);
    if (!normalised) return invalidDrawResult();
    if (state.draws.some((draw) => draw.issue === normalised.issue)) {
      return {
        ok: false,
        error: {
          type: "duplicate-issue",
          message: `期号 ${normalised.issue} 已存在，不能重复保存。`,
        },
      };
    }

    try {
      await enqueueWrite(() => storage.putDraw(normalised));
      replaceState([...state.draws, normalised]);
      state.lastOperationMessage = `已保存第 ${normalised.issue} 期开奖号码。`;
      return { ok: true, value: normalised };
    } catch {
      return storageFailureResult();
    }
  };

  const importCsv = async (csvText: string): Promise<ImportDrawCsvResult> => {
    const lines = csvText
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      return {
        ok: false,
        error: {
          type: "invalid-draw",
          message: "CSV 至少需要表头和一条开奖数据。",
        },
      };
    }

    const headers = lines[0].split(",").map((item) => item.trim());
    if (headers.join(",") !== CSV_HEADERS.join(",")) {
      return {
        ok: false,
        error: {
          type: "invalid-draw",
          message: `CSV 表头必须为：${CSV_HEADERS.join(",")}`,
        },
      };
    }

    const additions: DrawRecord[] = [];
    const rejected: CsvRejectedRow[] = [];
    const existingIssues = new Set(state.draws.map((draw) => draw.issue));

    lines.slice(1).forEach((line, index) => {
      const columns = line.split(",").map((item) => item.trim());
      const lineNumber = index + 2;
      if (columns.length !== CSV_HEADERS.length) {
        rejected.push({
          line: lineNumber,
          content: line,
          reason: "列数不符合约定。",
        });
        return;
      }
      const draw = normaliseDraw({
        issue: columns[0],
        date: columns[1],
        redNumbers: columns.slice(2, 8).map(Number),
        blueNumber: Number(columns[8]),
      });
      if (!draw) {
        rejected.push({
          line: lineNumber,
          content: line,
          reason: "期号、日期或号码不合法。",
        });
        return;
      }
      if (existingIssues.has(draw.issue)) {
        rejected.push({
          line: lineNumber,
          content: line,
          reason: `期号 ${draw.issue} 重复。`,
        });
        return;
      }
      existingIssues.add(draw.issue);
      additions.push(draw);
    });

    try {
      await enqueueWrite(() => storage.putDraws(additions));
      replaceState([...state.draws, ...additions]);
      state.lastOperationMessage = `已导入 ${additions.length} 条记录${rejected.length ? `，拒绝 ${rejected.length} 行` : ""}。`;
      return {
        ok: true,
        added: additions,
        rejected,
        message: state.lastOperationMessage,
      };
    } catch {
      return storageFailureResult();
    }
  };

  const runOfficialSync = async (
    load: () => Promise<OfficialHistoryResponse>,
  ): Promise<OfficialHistorySyncResult> => {
    if (state.officialSync.status === "syncing") {
      return {
        ok: false,
        error: {
          type: "official-sync-failure",
          message: "官方开奖数据正在同步，请等待当前任务完成。",
        },
      };
    }

    state.officialSync = {
      status: "syncing",
      currentPage: 0,
      pageTotal: null,
      collectedCount: 0,
    };
    try {
      const remote = await load();
      state.officialSync = {
        status: "syncing",
        currentPage:
          remote.pageTotal === 1 ? 1 : state.officialSync.currentPage || 1,
        pageTotal: remote.pageTotal,
        collectedCount: remote.records.length,
      };
      const existingIssues = new Set(state.draws.map((draw) => draw.issue));
      const additions: DrawRecord[] = [];
      let skippedExisting = 0;
      let skippedInvalid = 0;

      remote.records.forEach((record) => {
        const draw = normaliseOfficialDraw(record);
        if (!draw) {
          skippedInvalid += 1;
          return;
        }
        if (existingIssues.has(draw.issue)) {
          skippedExisting += 1;
          return;
        }
        existingIssues.add(draw.issue);
        additions.push(draw);
      });

      await enqueueWrite(() => storage.putDraws(additions));
      replaceState([...state.draws, ...additions]);
      state.lastOperationMessage = `官方开奖同步完成：新增 ${additions.length} 期，已存在 ${skippedExisting} 期，跳过异常 ${skippedInvalid} 期。`;
      return {
        ok: true,
        added: additions,
        skippedExisting,
        skippedInvalid,
        pageTotal: remote.pageTotal,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "官方开奖同步失败，请稍后重试。";
      state.lastOperationMessage = message;
      return { ok: false, error: { type: "official-sync-failure", message } };
    } finally {
      state.officialSync.status = "idle";
    }
  };

  const syncOfficialHistory = async (): Promise<OfficialHistorySyncResult> =>
    runOfficialSync(() =>
      fetchOfficialHistory((progress) => {
        state.officialSync = { status: "syncing", ...progress };
      }),
    );

  const syncLatestOfficialDraws =
    async (): Promise<OfficialHistorySyncResult> =>
      runOfficialSync(fetchOfficialLatestDraws);

  const replaceAll = async (
    draws: readonly DrawRecord[],
  ): Promise<ReplaceDrawsResult> => {
    const normalisedDraws: DrawRecord[] = [];
    const issues = new Set<string>();
    for (const draw of draws) {
      const normalised = normaliseDraw(draw);
      if (!normalised) return invalidDrawResult();
      if (issues.has(normalised.issue)) {
        return {
          ok: false,
          error: {
            type: "duplicate-issue",
            message: `备份中存在重复期号 ${normalised.issue}。`,
          },
        };
      }
      issues.add(normalised.issue);
      normalisedDraws.push(normalised);
    }

    try {
      await enqueueWrite(() => storage.replaceDraws(normalisedDraws));
      replaceState(normalisedDraws);
      state.lastOperationMessage = `已恢复 ${normalisedDraws.length} 条开奖记录。`;
      return { ok: true, value: [...state.draws] };
    } catch {
      return storageFailureResult();
    }
  };

  return {
    state,
    initialize,
    saveDraw,
    importCsv,
    syncOfficialHistory,
    syncLatestOfficialDraws,
    replaceAll,
    dispose: () => {
      state.lastOperationMessage = null;
    },
  };
}

function normaliseOfficialDraw(record: OfficialDrawNotice): DrawRecord | null {
  return normaliseDraw({
    issue: record.code,
    date: record.date.slice(0, 10),
    redNumbers: record.red.split(",").map((number) => Number(number.trim())),
    blueNumber: Number(record.blue.trim()),
  });
}

export function normaliseDraw(input: DrawInput): DrawRecord | null {
  const issue = String(input?.issue ?? "").trim();
  const date = String(input?.date ?? "").trim();
  const redNumbers = [...(input?.redNumbers ?? [])].map(Number);
  const blueNumber = Number(input?.blueNumber);

  if (
    !issue ||
    !isIsoDate(date) ||
    redNumbers.length !== LOTTERY_CONSTANTS.redCount
  )
    return null;
  if (
    !Number.isInteger(blueNumber) ||
    blueNumber < 1 ||
    blueNumber > LOTTERY_CONSTANTS.blueMaximum
  )
    return null;
  if (
    redNumbers.some(
      (number) =>
        !Number.isInteger(number) ||
        number < 1 ||
        number > LOTTERY_CONSTANTS.redMaximum,
    )
  )
    return null;

  const sortedRedNumbers = [...redNumbers].sort((left, right) => left - right);
  if (new Set(sortedRedNumbers).size !== LOTTERY_CONSTANTS.redCount)
    return null;
  return { issue, date, redNumbers: sortedRedNumbers, blueNumber };
}

function invalidDrawResult(): { ok: false; error: DrawDataError } {
  return {
    ok: false,
    error: {
      type: "invalid-draw",
      message: "请填写期号、有效日期、6 个不重复红球和 1 个范围内蓝球。",
    },
  };
}

function storageFailureResult(): { ok: false; error: DrawDataError } {
  return {
    ok: false,
    error: {
      type: "storage-failure",
      message: "IndexedDB 未能保存开奖记录，请检查浏览器存储权限。",
    },
  };
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function sortDraws(draws: readonly DrawRecord[]): DrawRecord[] {
  return [...draws].sort((left, right) => {
    const dateOrder = left.date.localeCompare(right.date);
    return dateOrder === 0 ? compareIssues(left.issue, right.issue) : dateOrder;
  });
}

export function compareIssues(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber))
    return leftNumber - rightNumber;
  return left.localeCompare(right);
}

function createSummary(draws: readonly DrawRecord[]): DrawSummary {
  return {
    totalDraws: draws.length,
    latestDraw: draws.length ? draws[draws.length - 1] : null,
    redFrequencies: createFrequencies(
      draws,
      LOTTERY_CONSTANTS.redMaximum,
      (draw) => draw.redNumbers,
    ),
    blueFrequencies: createFrequencies(
      draws,
      LOTTERY_CONSTANTS.blueMaximum,
      (draw) => [draw.blueNumber],
    ),
  };
}

function createFrequencies(
  draws: readonly DrawRecord[],
  maximum: number,
  values: (draw: DrawRecord) => readonly number[],
): BallFrequency[] {
  const counts = Array.from({ length: maximum }, () => 0);
  draws.forEach((draw) =>
    values(draw).forEach((number) => (counts[number - 1] += 1)),
  );
  return counts.map((count, index) => ({
    number: index + 1,
    count,
    rate: draws.length ? count / draws.length : 0,
  }));
}
