# 双色球概率实验室 - 技术设计

页面代码约定：[项目上下文](../../README.md#页面代码约定)

## 代码定位

| 项目 | 路径 |
|---|---|
| 页面入口 | `src/views/lottery-probability-lab/index.vue` |
| 视图模块目录 | `src/views/lottery-probability-lab/` |

## 视图模块根级状态

根级状态只拥有页面区域共享的算法选择和恢复提示；开奖记录、候选批次、审计和复盘状态分别由单元拥有。

```ts
type AlgorithmId =
  | 'uniform-baseline'
  | 'randomness-audit'
  | 'bayesian-static'
  | 'time-decay'
  | 'pair-dependence'
  | 'scored-ensemble'
  | 'coverage-optimizer'

interface LotteryProbabilityLabViewState {
  activeAlgorithmId: AlgorithmId
  restoreWarning: string | null
  automaticSync: AutomaticOfficialSyncStatus
}
```

## 视图模块入口

| 项目 | 名称或签名 | 作用 |
|---|---|---|
| 入口函数 | `useLotteryProbabilityLabViewModule(): LotteryProbabilityLabViewModule` | 创建本页面使用的完整视图模块。 |
| 对外类型 | `LotteryProbabilityLabViewModule` | 暴露根级状态、单元和跨单元操作。 |

```ts
function useLotteryProbabilityLabViewModule(): LotteryProbabilityLabViewModule

interface LotteryProbabilityLabViewModule {
  readonly state: Readonly<LotteryProbabilityLabViewState>
  readonly drawData: DrawDataUnit
  readonly prediction: PredictionUnit
  readonly review: ReviewUnit
  selectAlgorithm(algorithmId: AlgorithmId): void
  importDrawCsv(csvText: string): Promise<ImportDrawCsvResult>
  syncOfficialHistory(): Promise<OfficialHistorySyncResult>
  syncLatestOfficialDraws(): Promise<OfficialHistorySyncResult>
  generatePrediction(): Promise<PredictionOperationResult>
  runRollingBacktest(): Promise<BacktestReport>
  exportBackup(): Promise<BackupExportResult>
  importBackup(jsonText: string): Promise<BackupImportResult>
  initialize(): Promise<void>
  dispose(): void
}

interface BackupDocument {
  format: 'shuangseqiu-probability-lab-backup'
  version: 1
  exportedAt: string
  activeAlgorithmId: AlgorithmId
  draws: readonly DrawRecord[]
  snapshots: readonly PredictionSnapshot[]
  evaluations: readonly PredictionEvaluation[]
}

type BackupExportResult =
  | { ok: true; value: BackupDocument }
  | { ok: false; error: BackupError }

type BackupImportResult =
  | { ok: true; value: BackupDocument }
  | { ok: false; error: BackupError }

type BackupError =
  | { type: 'invalid-backup'; message: string }
  | { type: 'storage-failure'; message: string }
```

## 单元组成

| 单元 | 对外类型 | 负责能力 | 技术设计 |
|---|---|---|---|
| 开奖数据单元 | `DrawDataUnit` | 校验、导入、排序和本地保存开奖记录，提供只读数据概览。 | [开奖数据单元](units/draw-data.md) |
| 候选计算单元 | `PredictionUnit` | 输出算法定义、滚动回测报告、每种算法的 5 组 × 3 注奖级覆盖候选、证明过程和不可变预测快照。 | [候选计算单元](units/prediction.md) |
| 复盘单元 | `ReviewUnit` | 保存预测快照、使用首个后续开奖对照，汇总理论与经验统计。 | [复盘单元](units/review.md) |

## 页面能力绑定

| 页面区域 | 顶层组件 | 读取的只读状态 | 组件事件或生命周期 | 绑定能力 |
|---|---|---|---|---|
| 页面生命周期 | `src/views/lottery-probability-lab/index.vue` | `state`、各单元状态 | `onMounted` / `onBeforeUnmount` / 页面重新可见 | `initialize()` / `dispose()` / 补拉与重排定时器 |
| 顶部状态栏 | `components/LotteryHeader.vue` | `drawData.state.summary`、`drawData.state.officialSync`、`state.automaticSync`、`review.state.statistics` | 自动状态展示、CSV 导入、生成、导出备份、恢复备份 | 自动同步由生命周期驱动；`importDrawCsv()`、`generatePrediction()`、`exportBackup()`、`importBackup()` 仅响应用户操作 |
| 数据概览 | `components/DataOverviewPanel.vue` | `drawData.state` | 无副作用 | 只读呈现开奖数据、频率与录入提示 |
| 算法工作区 | `components/AlgorithmWorkspace.vue` | `prediction.state`、`drawData.state.summary` | 请求滚动回测、请求计算、已有快照后的连续生成 | `runRollingBacktest()` / `generatePrediction()`；无论当前算法是否已有批次都保留生成入口，并呈现 5 个覆盖大组和证明过程 |
| 预测与复盘账本 | `components/PredictionLedgerPanel.vue` | `prediction.state.currentBatch`、`review.state` | 无副作用 | 只读呈现 5 组覆盖快照、每注角色、奖级命中和证明过程摘要 |
| 右侧算法栏 | `components/AlgorithmSidebar.vue` | `state.activeAlgorithmId`、`prediction.state.algorithms` | `select` | `selectAlgorithm()` |

## 跨单元协调

| 触发动作 | 协调行为 | 失败时 |
|---|---|---|
| 初始化 | 打开页面私有 IndexedDB；首次打开时迁移旧版 localStorage 的开奖记录、快照、对照和算法选择。候选单元按每种算法的最新 `recordedAt` 快照恢复工作区；无开奖记录时自动全量同步官方往期；有数据时自动补拉官方第 1 页；随后对照未对照快照并排定下一次北京时间开奖日 21:30 同步。 | 迁移、读取、代理或同步失败时保留旧数据、产生恢复提示并让页面保持可使用；不得清除旧 localStorage 数据。 |
| 保存单期或导入 CSV | 数据单元先完整校验并通过 IndexedDB 事务保存新记录；视图模块把最新开奖记录传给复盘单元对照未对照快照。 | 数据单元返回错误时，复盘和候选状态不得改变。 |
| 首次自动全量同步 | 开奖数据单元通过页面私有 API 逐页请求官方双色球接口，收集并规范化全部响应后一次写入新增期号；成功后视图模块执行未对照快照对照。 | 任一页请求、分页或响应失败时，本轮远程数据不得写入 IndexedDB；已有数据、复盘和候选状态不变。 |
| 开奖日 21:30 自动补拉 | 视图模块以北京时间计算下一个周二、四、日 21:30；触发后请求官方第 1 页最新记录，新增后执行对照。若当日开奖结果尚未出现则每 5 分钟重试至 22:30；页面再次可见时补拉并重新排定。 | 页面关闭时不运行定时器；下一次打开页面补拉。所有请求失败仅提示状态，不改变已有数据。 |
| 导出或恢复备份 | 视图模块从三个单元读取完整归档，导出版本化 JSON；恢复时先在内存完整校验，成功后以替换语义提交所有 IndexedDB 记录并重新对照。 | 解析、校验或提交失败时，IndexedDB 中的既有数据不得被部分改写。 |
| 运行滚动回测 | 候选单元以冻结的最近 160 期训练窗口评估最近至多 180 个预测期，保存当前内存回测报告并为评分集成提供权重。 | 数据不足或计算失败时保留最后一次已完成报告，返回可读研究状态。 |
| 生成五组覆盖候选 | 候选单元先取得当前回测报告，再按当前算法实际计算 5 个一等奖锚点，并为每组派生 1 个同红备用蓝票和 1 个同主蓝五红替换票；成功后视图模块把 15 注、覆盖角色、证明过程、候选身份和回测摘要交给复盘单元保存为不可变快照。已有快照时仍允许生成新批次。 | 审计算法或计算失败时不得创建快照；同一数据截止期重复生成必须在页面中说明仅改变独立随机种子。 |
| 选择算法 | 根级状态更新；候选单元从按算法索引的最新已保存批次恢复当前工作区，不重新计算、不写入快照。 | 未知算法标识被忽略并保留当前选择；审计算法清空候选工作区。 |

## 路由、权限与生命周期

| 场景 | 行为 |
|---|---|
| 路由参数与查询参数 | 页面使用根路由 `/`，不读取或同步路由参数。 |
| 页面权限 | 无登录、权限或角色限制。 |
| 初始化 | 创建视图模块，完成旧 localStorage 迁移（如有）后恢复 IndexedDB 状态，并自动对照符合条件的未对照快照。 |
| 页面离开 | 清除开奖日自动同步、重试定时器和页面可见性监听；本地数据已在操作成功时同步保存。 |

## 本地持久化与备份

- 页面私有数据库名为 `shuangseqiu-probability-lab`，版本由 `src/views/lottery-probability-lab/storage/index.ts` 管理。
- 外部开奖请求封装在 `src/views/lottery-probability-lab/api/official-history.ts`；它区分首次全量分页查询和自动补拉的第 1 页查询，处理官方远程字段结构，并由开奖数据单元调用。本地开发请求通过 `vite.config.ts` 的 `/official-cwl-api` 同源代理，生产请求要求以 `/` 开头的 `VITE_CWL_API_BASE`。
- IndexedDB 使用 `draws`、`predictionSnapshots`、`evaluations` 和 `metadata` 对象仓；前 3 者分别以期号、快照 ID 和快照 ID 为键，`metadata` 保存数据库元数据与迁移标记。
- 开奖数据单元和复盘单元仅通过页面私有存储入口读写各自对象仓；组件不得直接接触浏览器存储。
- 备份为版本化 JSON 文档，恢复采用“先校验、后完整替换”的单次工作流；不支持按记录局部合并，以避免期号、快照与对照关系不一致。
- 当前算法选择作为 metadata 保存到 IndexedDB，同时保留对旧 localStorage 轻量选择的兼容读取。
- 滚动回测报告只存在于候选单元内存中，由当前开奖记录的数据签名决定是否复用；不修改 IndexedDB 中的历史预测快照。新批次会写入候选身份与回测指标摘要；旧快照 / v1 备份缺少这些字段时，读取端按候选单元文档的默认研究身份映射。

## 算法边界

- **均匀组合基准**是公平抽取的默认零假设；它始终生成 5 组 × 3 注互不重复的奖级覆盖候选，也是其他模型的滚动回测对照。
- **随机性审计**只返回频率、近期偏离、号码对共同出现和解释性结论，不生成购票候选或预测快照。
- **贝叶斯静态偏差**以红球、蓝球历史出现次数形成收缩后的权重，并在红球无放回抽样约束下生成研究候选。
- **时间衰减偏差**以指数衰减累计近期号码出现权重；它不是“遗漏必出”规则。
- **组合依赖**使用红球对共同出现的平滑评分作为研究候选排序信号。
- **滚动评分集成**根据上一轮冻结回测中贝叶斯与时间衰减的相对复合分差生成非负混合权重；没有正向表现时使用等权研究组合。
- **三注覆盖优化**从算法候选池选取三注，优先减少红球重复与整注重复；它不改变任意单注的理论概率。
- **滚动历史回测**固定训练窗口为最近 160 期、优先评估最近 180 个可用预测期。每个预测期只使用此前窗口数据，并用固定种子生成各算法的 3 注候选；回测报告不得使用未来数据重新调整该期参数。
- **奖级覆盖派生**：每个算法先生成 5 个锚点组合；每个锚点派生同 6 红的备用蓝球票和同主蓝、5 红保留 / 1 红替换票。备用蓝和替换红根据当前算法的候补权重 / 排名确定，并随批次保存证明过程。
- **候选身份**：所有预测型算法都实际生成自己的 5 组覆盖候选。评估期不足 120 或 95% 差异下界不大于 0 时标记为“研究候选”；满足门槛时标记为“回测通过”。两者都不得宣传为提高未来中奖概率。

## 代码映射

| 代码项 | 路径与符号 |
|---|---|
| 页面入口 | `src/views/lottery-probability-lab/index.vue` |
| 视图模块入口与类型 | `src/views/lottery-probability-lab/module.ts#useLotteryProbabilityLabViewModule` · `LotteryProbabilityLabViewModule` |
| 共享类型 | `src/views/lottery-probability-lab/types.ts` |
| 开奖数据单元 | `src/views/lottery-probability-lab/units/draw-data/index.ts#useDrawDataUnit` |
| 候选计算单元 | `src/views/lottery-probability-lab/units/prediction/index.ts#usePredictionUnit` · `PredictionUnit` · `runBacktest()` |
| 页面私有 API | `src/views/lottery-probability-lab/api/official-history.ts#fetchOfficialHistory` |
| 页面私有存储入口 | `src/views/lottery-probability-lab/storage/index.ts#createLotteryLabStorage` |
| 复盘单元 | `src/views/lottery-probability-lab/units/review/index.ts#useReviewUnit` |
| 顶部操作栏 | `src/views/lottery-probability-lab/components/LotteryHeader.vue` |
| 数据概览 | `src/views/lottery-probability-lab/components/DataOverviewPanel.vue` |
| 算法工作区 | `src/views/lottery-probability-lab/components/AlgorithmWorkspace.vue` · `runBacktest()` / `generate()` 绑定 |
| 预测与复盘账本 | `src/views/lottery-probability-lab/components/PredictionLedgerPanel.vue` |
| 右侧算法栏 | `src/views/lottery-probability-lab/components/AlgorithmSidebar.vue` |
