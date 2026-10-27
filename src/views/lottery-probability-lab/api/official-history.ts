const OFFICIAL_HISTORY_PATH =
  "/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice";
const runtimeEnv = import.meta.env ?? { DEV: true };
const configuredApiBase = runtimeEnv.VITE_CWL_API_BASE?.trim().replace(
  /\/$/,
  "",
);
const isSameOriginProxyBase = Boolean(configuredApiBase?.startsWith("/"));
const OFFICIAL_HISTORY_ENDPOINT =
  runtimeEnv.DEV !== false
    ? `/official-cwl-api${OFFICIAL_HISTORY_PATH}`
    : isSameOriginProxyBase
      ? `${configuredApiBase}${OFFICIAL_HISTORY_PATH}`
      : null;
const PAGE_SIZE = 30;
const MAX_PAGE_TOTAL = 500;

export interface OfficialDrawNotice {
  code: string;
  date: string;
  red: string;
  blue: string;
}

export interface OfficialHistoryProgress {
  currentPage: number;
  pageTotal: number;
  collectedCount: number;
}

export interface OfficialHistoryResponse {
  pageTotal: number;
  records: readonly OfficialDrawNotice[];
}

export class OfficialHistoryRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficialHistoryRequestError";
  }
}

export async function fetchOfficialLatestDraws(): Promise<OfficialHistoryResponse> {
  return fetchOfficialHistoryPage(1);
}

export async function fetchOfficialHistory(
  onProgress: (progress: OfficialHistoryProgress) => void,
): Promise<OfficialHistoryResponse> {
  const firstPage = await fetchOfficialHistoryPage(1);
  const records = [...firstPage.records];
  onProgress({
    currentPage: 1,
    pageTotal: firstPage.pageTotal,
    collectedCount: records.length,
  });

  for (let pageNo = 2; pageNo <= firstPage.pageTotal; pageNo += 1) {
    const page = await fetchOfficialHistoryPage(pageNo);
    if (page.pageTotal !== firstPage.pageTotal) {
      throw new OfficialHistoryRequestError(
        "官方接口的总页数在同步过程中发生变化，请稍后重新同步。",
      );
    }
    records.push(...page.records);
    onProgress({
      currentPage: pageNo,
      pageTotal: firstPage.pageTotal,
      collectedCount: records.length,
    });
  }

  return { pageTotal: firstPage.pageTotal, records };
}

async function fetchOfficialHistoryPage(
  pageNo: number,
): Promise<OfficialHistoryResponse> {
  if (!OFFICIAL_HISTORY_ENDPOINT) {
    throw new OfficialHistoryRequestError(
      "当前部署未配置同源官方开奖反向代理。开发环境可直接使用 Vite 代理；部署时请把 VITE_CWL_API_BASE 设置为以 / 开头的同源路径。",
    );
  }

  const search = new URLSearchParams({
    name: "ssq",
    issueCount: "",
    issueStart: "",
    issueEnd: "",
    dayStart: "",
    dayEnd: "",
    pageNo: String(pageNo),
    pageSize: String(PAGE_SIZE),
    week: "",
    systemType: "PC",
  });

  let response: Response;
  try {
    response = await fetch(
      `${OFFICIAL_HISTORY_ENDPOINT}?${search.toString()}`,
      {
        headers: { Accept: "application/json, text/plain, */*" },
      },
    );
  } catch {
    throw new OfficialHistoryRequestError(
      "无法连接中国福利彩票开奖接口，请检查网络或浏览器跨域权限。",
    );
  }

  if (!response.ok) {
    throw new OfficialHistoryRequestError(
      `中国福利彩票开奖接口返回 HTTP ${response.status}。`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new OfficialHistoryRequestError(
      "中国福利彩票开奖接口未返回可解析的 JSON 数据。",
    );
  }

  if (!isObject(payload) || Number(payload.state) !== 0) {
    throw new OfficialHistoryRequestError(
      isObject(payload) && typeof payload.message === "string"
        ? `中国福利彩票开奖接口返回失败：${payload.message}`
        : "中国福利彩票开奖接口返回了无效结果。",
    );
  }

  const pageTotal = Number(payload.pageNum ?? payload.pageTotal);
  if (
    !Number.isInteger(pageTotal) ||
    pageTotal < 1 ||
    pageTotal > MAX_PAGE_TOTAL ||
    !Array.isArray(payload.result)
  ) {
    throw new OfficialHistoryRequestError(
      "中国福利彩票开奖接口的分页或记录格式无效。",
    );
  }

  const records = payload.result.filter(isOfficialDrawNotice);
  if (records.length !== payload.result.length) {
    throw new OfficialHistoryRequestError(
      "中国福利彩票开奖接口包含无法识别的记录格式。",
    );
  }

  return { pageTotal, records };
}

function isOfficialDrawNotice(value: unknown): value is OfficialDrawNotice {
  return Boolean(
    isObject(value) &&
      typeof value.code === "string" &&
      typeof value.date === "string" &&
      typeof value.red === "string" &&
      typeof value.blue === "string",
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
