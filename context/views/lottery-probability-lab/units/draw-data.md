# 双色球概率实验室 - 开奖数据单元技术设计

页面稳定代码骨架：[页面技术设计](../technical-design.md)

## 单元职责

开奖数据单元拥有开奖记录的校验、单期保存、CSV 导入、官方分页同步、稳定排序、频率摘要和 IndexedDB 持久化。它不生成预测，不写入预测快照，也不直接调用复盘单元。

## 单元入口

| 项目 | 名称或签名 | 作用 |
|---|---|---|
| 入口函数 | `useDrawDataUnit(): DrawDataUnit` | 创建开奖记录工作流。 |
| 对外类型 | `DrawDataUnit` | 暴露只读开奖记录、摘要和写入操作。 |

```ts
function useDrawDataUnit(): DrawDataUnit

interface DrawDataUnit {
  readonly state: Readonly<DrawDataState>
  initialize(): Promise<RestoreResult>
  saveDraw(input: DrawInput): Promise<DrawOperationResult>
  importCsv(csvText: string): Promise<ImportDrawCsvResult>
  syncOfficialHistory(): Promise<OfficialHistorySyncResult>
  syncLatestOfficialDraws(): Promise<OfficialHistorySyncResult>
  replaceAll(draws: readonly DrawRecord[]): Promise<ReplaceDrawsResult>
  dispose(): void
}
```

## 状态结构

```ts
interface DrawDataState {
  draws: readonly DrawRecord[]
  summary: DrawSummary
  officialSync: OfficialHistorySyncProgress
  lastOperationMessage: string | null
}
```

| 状态 | 初始值 | 含义 |
|---|---|---|
| `draws` | `[]` | 按日期、期号升序保存的合法开奖记录。 |
| `summary` | 空摘要 | 总期数、最新期、红蓝球频率和数据提示。 |
| `officialSync` | 空闲状态 | 官方历史同步的运行状态、当前页、总页数与已规范化记录数。 |
| `lastOperationMessage` | `null` | 最近一次导入、保存或同步的可见结果。 |

## 输入、输出与错误类型

```ts
interface DrawInput {
  issue: string
  date: string
  redNumbers: number[]
  blueNumber: number
}

interface DrawRecord extends DrawInput {
  redNumbers: readonly number[]
}

type DrawOperationResult =
  | { ok: true; value: DrawRecord }
  | { ok: false; error: DrawDataError }

type DrawDataError =
  | { type: 'invalid-draw'; message: string }
  | { type: 'duplicate-issue'; message: string }
  | { type: 'storage-failure'; message: string }

type ReplaceDrawsResult =
  | { ok: true; value: readonly DrawRecord[] }
  | { ok: false; error: DrawDataError }

interface OfficialHistorySyncProgress {
  status: 'idle' | 'syncing'
  currentPage: number
  pageTotal: number | null
  collectedCount: number
}

type OfficialHistorySyncResult =
  | { ok: true; added: readonly DrawRecord[]; skippedExisting: number; skippedInvalid: number; pageTotal: number }
  | { ok: false; error: { type: 'official-sync-failure'; message: string } }
```

## 方法行为

| 方法 | 前置条件 | 状态变化 | 成功结果 | 失败结果 |
|---|---|---|---|---|
| `initialize()` | IndexedDB 已打开。 | 从 `draws` 对象仓恢复合法记录并重算摘要。 | 返回恢复条数和可选警告。 | 保留现有内存状态并返回警告。 |
| `saveDraw(input)` | 输入符合号码、日期和唯一性规则。 | 通过 IndexedDB 事务保存新记录，重算摘要。 | 返回标准化记录。 | 返回 `invalid-draw`、`duplicate-issue` 或 `storage-failure`，已有记录不变。 |
| `importCsv(csvText)` | CSV 使用需求约定的列名。 | 逐行校验后用一次 IndexedDB 写入添加合法且不重复的记录，重算摘要。 | 返回添加记录数和被拒绝行。 | 空文本、表头不符或存储失败时，已保存记录不被破坏。 |
| `syncOfficialHistory()` | 当前不处于同步状态，官方接口可访问。 | 首次全量逐页拉取、规范化远程记录；只有所有页面成功后才一次写入新增期号并重算摘要。 | 返回新增、已存在跳过、非法跳过和总页数。 | 返回 `official-sync-failure`，保留现有 IndexedDB 和内存状态。 |
| `syncLatestOfficialDraws()` | 当前不处于同步状态，官方接口可访问。 | 请求官方第 1 页、规范化并一次写入其中的新增期号，重算摘要。 | 返回新增、已存在跳过、非法跳过和总页数。 | 返回 `official-sync-failure`，保留现有 IndexedDB 和内存状态。 |
| `replaceAll(draws)` | 调用方已完成备份完整性校验。 | 用传入记录完整替换 `draws` 对象仓，重算摘要。 | 返回已保存的完整记录集合。 | `invalid-draw` 或 `storage-failure`，内存和持久化状态不发生部分替换。 |

## 并发与生命周期

| 场景 | 处理方式 |
|---|---|
| 重复调用 | 通过单元内的异步写入队列按调用顺序提交；每次成功操作在 IndexedDB 事务完成后更新状态。 |
| 并发结果 | 较早操作失败时不得覆盖较晚的已成功状态；同一对象仓替换与增量写入不可交错提交。 |
| 释放 | 不保留订阅或异步任务。 |

## 业务规则执行

| 业务规则 | 执行方法 | 执行方式 | 失败结果 |
|---|---|---|---|
| [双色球号码范围](../requirements.md#业务规则) | `saveDraw()`、`importCsv()` | 标准化、排序、范围与唯一性校验。 | `invalid-draw` |
| [开奖数据完整性](../requirements.md#业务规则) | `saveDraw()`、`importCsv()` | 检查期号、日期和已存期号。 | `invalid-draw` 或 `duplicate-issue` |
| [CSV 约定](../requirements.md#业务规则) | `importCsv()` | 检查表头和每行字段。 | 返回逐行拒绝原因。 |
| [本地数据边界](../requirements.md#业务规则) | 所有写入方法 | 仅通过页面私有 IndexedDB 存储入口读写其拥有的对象仓。 | `storage-failure` |
| [自动官方同步](../requirements.md#业务规则) | `syncOfficialHistory()`、`syncLatestOfficialDraws()` | 通过页面私有 API 使用全量 `fetchOfficialHistory()` 或第 1 页 `fetchOfficialLatestDraws()`，规范化后去重并一次提交。 | `official-sync-failure` |

## 代码映射

| 代码项 | 路径与符号 |
|---|---|
| 单元入口与类型 | `src/views/lottery-probability-lab/units/draw-data/index.ts#useDrawDataUnit` · `DrawDataUnit` |
