# 双色球概率实验室 - 候选计算单元技术设计

页面稳定代码骨架：[页面技术设计](../technical-design.md)

## 单元职责

候选计算单元拥有算法目录、当前算法的可解释结果、随机性审计、冻结滚动历史回测、各预测型算法的三注候选和候选身份判定。它只接收只读开奖记录，不能修改开奖记录，也不直接写入历史快照。

随机性审计不生成候选。均匀基准、贝叶斯静态偏差、时间衰减、组合依赖、滚动评分集成和三注覆盖优化都必须实际计算本算法的 5 组 × 3 注候选；研究候选和回测通过候选都不得表述为提高未来中奖概率的保证。

## 单元入口

| 项目 | 名称或签名 | 作用 |
|---|---|---|
| 入口函数 | `usePredictionUnit(getDraws): PredictionUnit` | 创建候选、审计与回测工作流。 |
| 对外类型 | `PredictionUnit` | 暴露算法、回测报告、当前批次和计算操作。 |

```ts
function usePredictionUnit(getDraws: () => readonly DrawRecord[]): PredictionUnit

interface PredictionUnit {
  readonly state: Readonly<PredictionState>
  selectAlgorithm(algorithmId: AlgorithmId): void
  hydrateSnapshots(snapshots: readonly PredictionSnapshot[]): void
  runBacktest(): Promise<BacktestReport>
  generate(): Promise<PredictionOperationResult>
  dispose(): void
}
```

## 状态结构

```ts
interface PredictionState {
  algorithms: readonly AlgorithmDefinition[]
  activeAlgorithmId: AlgorithmId
  currentBatch: PredictionBatch | null
  batchesByAlgorithm: Readonly<Partial<Record<PredictiveAlgorithmId, PredictionBatch>>>
  currentAudit: AuditReport | null
  backtest: BacktestReport | null
  isBacktesting: boolean
  lastOperationMessage: string | null
}
```

| 状态 | 初始值 | 含义 |
|---|---|---|
| `algorithms` | 固定算法目录 | 菜单名称、定位、候选 / 审计类别和说明。 |
| `activeAlgorithmId` | `uniform-baseline` | 当前右侧菜单选择。 |
| `currentBatch` | `null` | 当前右侧算法在工作区展示的最近预测批次。 |
| `batchesByAlgorithm` | 空映射 | 每种预测型算法最近一次生成或从快照恢复的批次；不包含随机性审计。 |
| `currentAudit` | `null` | 最近一次随机性审计结果。 |
| `backtest` | `null` | 当前开奖记录签名对应的冻结滚动回测报告。 |
| `isBacktesting` | `false` | 是否正在计算回测，避免同一数据集并发重复计算。 |
| `lastOperationMessage` | `null` | 回测、候选、数据不足或研究性提示。 |

## 输入、输出与错误类型

```ts
type CandidateTier = 'baseline' | 'research' | 'validated'

interface AlgorithmBacktestMetric {
  algorithmId: Exclude<AlgorithmId, 'randomness-audit'>
  evaluationPeriods: number
  averageRedHitsPerTicket: number
  blueHitRatePerTicket: number
  averageCompositeScorePerTicket: number
  meanCompositeScoreDelta: number | null
  compositeScoreDeltaLower95: number | null
  periodWinRate: number | null
  periodTieRate: number | null
  candidateTier: CandidateTier
  validationMessage: string
}

interface BacktestReport {
  algorithmVersion: 'backtest-v1'
  dataSignature: string
  trainingWindow: 160
  requestedEvaluationPeriods: 180
  evaluationPeriods: number
  evaluatedFromIssue: string | null
  evaluatedToIssue: string | null
  generatedAt: string
  metrics: readonly AlgorithmBacktestMetric[]
  ensembleWeights: {
    bayesianStatic: number
    timeDecay: number
  }
}

interface PredictionBatch {
  id: string
  algorithmId: Exclude<AlgorithmId, 'randomness-audit'>
  effectiveAlgorithmId: Exclude<AlgorithmId, 'randomness-audit'>
  candidateTier: CandidateTier
  validationMessage: string
  backtestMetric: AlgorithmBacktestMetric | null
  coverageGroups: readonly PrizeCoverageGroup[]
  algorithmVersion: string
  sourceLatestIssue: string | null
  sourceLatestDate: string | null
  generatedAt: string
  seed: number
  fallbackReason: string | null
  combinations: readonly LotteryCombination[]
}

type PrizeCoverageRole = 'first-anchor' | 'second-blue-cover' | 'third-red-cover'

interface PrizeCoverageTicket extends LotteryCombination {
  groupIndex: number
  role: PrizeCoverageRole
}

interface CoverageProofStep {
  label: string
  value: string
  detail: string
}

interface PrizeCoverageGroup {
  groupIndex: number
  firstPrizeAnchor: PrizeCoverageTicket
  secondPrizeBlueCover: PrizeCoverageTicket
  thirdPrizeRedCover: PrizeCoverageTicket
  proofSteps: readonly CoverageProofStep[]
}

interface LotteryCombination {
  redNumbers: readonly number[]
  blueNumber: number
  score: number | null
}

type PredictionOperationResult =
  | { ok: true; value: PredictionBatch | AuditReport }
  | { ok: false; error: PredictionError }

type PredictionError =
  | { type: 'no-draw-data'; message: string }
  | { type: 'calculation-failure'; message: string }
```

## 冻结滚动回测规则

### 数据窗口与目标期

- 先将开奖记录按日期、再按期号升序排列。
- 训练窗口固定为最近连续的 **160** 期。
- 只有总期数至少为 `161` 时，才有一个可评估预测期；评估期数为 `min(180, draws.length - 160)`。
- 选择最近的评估期：若有 `N` 个可评估预测期，则从索引 `max(160, draws.length - 180)` 开始，到最后一条开奖记录结束。
- 对每个目标期索引 `t`，训练输入严格是 `draws.slice(t - 160, t)`，目标开奖结果严格是 `draws[t]`；目标期及其后续记录不能参与该期候选计算、集成权重或参数选择。

### 固定种子与数据签名

- 每个回测候选的固定种子由 32 位 FNV-1a 哈希派生：`fnv1a32('ssq-backtest-v1|' + algorithmId + '|' + target.issue + '|' + target.date)`。
- 同一训练窗口、算法、目标期和算法版本必须生成相同的 3 注回测对照候选；候选算法内部不得使用 `Math.random()`。
- `dataSignature` 为排序后全部开奖记录的稳定 FNV-1a 摘要：按 `issue|date|redNumbers.join('-')|blueNumber` 逐行连接，再加 `backtest-v1` 前缀后哈希。
- 只有当前 `dataSignature` 与 `backtest.dataSignature` 一致时可以复用内存回测报告；任意新增、导入、恢复或同步开奖记录都会使旧报告失效。回测报告不写入 IndexedDB、不写入预测快照、不影响旧快照的不可变性。

### 单期得分与比较口径

对任一目标期、任一算法的三注候选逐注计算：

```text
redHitCount = 该注红球与目标期红球的交集数量
blueHit = 该注蓝球是否等于目标期蓝球
compositeScore = redHitCount + (blueHit ? 0.5 : 0)
```

- `periodCompositeScore` 是该算法三注 `compositeScore` 的算术平均值。
- `periodRedHitsPerTicket` 是三注红球命中数的算术平均值。
- `periodBlueHitRatePerTicket` 是三注蓝球命中布尔值的算术平均值。
- 均匀组合基准也在**同一目标期**、以其自身固定种子生成三注，作为配对对照。
- 对非基准算法，`periodDelta = algorithm.periodCompositeScore - uniformBaseline.periodCompositeScore`；基准的 `meanCompositeScoreDelta`、95% 下界、胜率和和局率为 `null`。
- `averageRedHitsPerTicket`、`blueHitRatePerTicket`、`averageCompositeScorePerTicket` 是所有评估期、所有三注的相应平均值。
- `meanCompositeScoreDelta` 是所有 `periodDelta` 的算术平均值。
- 当评估期 `n >= 2` 时，`compositeScoreDeltaLower95 = meanDelta - 1.96 * sampleStdDev(periodDelta) / sqrt(n)`；`sampleStdDev` 使用 `n - 1` 分母。当 `n < 2` 时，该值为 `null`。
- `periodWinRate` 为 `periodDelta > 0` 的期数除以 `n`；`periodTieRate` 为 `periodDelta === 0` 的期数除以 `n`；平局不计入胜率。

### 评分集成的无未来泄漏规则

- 回测中的评分集成在目标期 `t` 只能使用本轮回测起点至 `t - 1` 已完成预测期中，贝叶斯静态偏差和时间衰减各自的 `periodDelta` 历史。
- 若此前没有比较期，两个权重固定为 `0.5 / 0.5`。
- 否则先计算此前各自 `meanDelta`，对每个均取 `max(0, meanDelta)`；若两者之和为 0，仍为 `0.5 / 0.5`，否则归一化为非负权重。
- 评分集成使用当期训练窗口的贝叶斯与时间衰减权重按上述比例混合后生成三注；不得使用当前目标期或未来期的结果决定当期集成权重。
- 当前未来候选使用报告中所有已完成评估期的最终非负权重；没有可用报告时使用等权研究组合。

### 身份判定

- `uniform-baseline` 的 `candidateTier` 固定为 `baseline`。
- 随机性审计没有 `PredictionBatch`，因此没有候选身份。
- 其他预测型算法在以下任一条件下都是 `research`：评估期少于 120、95% 下界为 `null`、或 `compositeScoreDeltaLower95 <= 0`。
- 只有评估期不少于 120 且 `compositeScoreDeltaLower95 > 0` 时为 `validated`。
- `validated` 只表示本冻结历史回测的门槛成立；不表示、暗示或保证未来中奖概率提高。
- 非审计算法生成新批次时，`effectiveAlgorithmId` 必须等于当前选择的 `algorithmId`；不得因研究身份回退为 `uniform-baseline`。
- 新批次必须创建正好 5 个 `PrizeCoverageGroup`，每组 3 注：锚点票为 6 红 + 主蓝；二等奖蓝球覆盖票与锚点 6 红完全相同、蓝球不同；三等奖红球覆盖票与锚点保留 5 红和主蓝，只替换 1 红。15 注不得重复。
- 新批次的 `fallbackReason` 固定为 `null`。旧快照的该字段保留为历史说明，不能用于推导当前算法行为。

## 依赖与回调

| 名称 | 签名 | 触发时机 |
|---|---|---|
| `getDraws` | `(): readonly DrawRecord[]` | 每次回测或计算前读取已保存开奖记录。 |

## 方法行为

| 方法 | 前置条件 | 状态变化 | 成功结果 | 失败结果 |
|---|---|---|---|---|
| `selectAlgorithm(algorithmId)` | 标识存在于算法目录。 | 更新当前选择；预测型算法把 `currentBatch` 切换到 `batchesByAlgorithm[algorithmId]`，审计算法清空候选工作区。 | 无返回值。 | 未知标识不改状态。 |
| `hydrateSnapshots(snapshots)` | 快照已经完成校验和恢复。 | 按 `recordedAt` 取每种算法最新快照，更新 `batchesByAlgorithm`；当前选择为预测型算法时同步更新 `currentBatch`。 | 无返回值。 | 非预测型或无效快照被忽略。 |
| `runBacktest()` | 记录按稳定顺序可读取。 | 数据签名变化时计算并更新 `backtest`，期间置 `isBacktesting = true`。 | 返回冻结报告；数据不足 161 条时返回 `evaluationPeriods = 0` 的研究报告。 | 不覆盖最后一次完整报告，设置可读错误提示。 |
| `generate()` | 至少存在一条开奖记录。 | 审计型算法更新 `currentAudit`；预测型算法生成或复用回测，再用当前选择的算法生成 5 组覆盖候选和证明过程并更新 `currentBatch`。 | 返回审计报告或 5 组 / 15 注批次。 | 返回 `no-draw-data` 或 `calculation-failure`。 |

## 并发与生命周期

| 场景 | 处理方式 |
|---|---|
| 重复调用 | 回测进行时复用同一个进行中的 Promise；候选计算等待当前回测完成。 |
| 快照恢复 | 只使用每种算法 `recordedAt` 最新的历史快照作为工作区展示；不重新生成候选，不修改快照。 |
| 并发结果 | 当前数据签名变化时旧回测结果不得覆盖新数据的报告；最后一次签名匹配的结果才提交。 |
| 释放 | 清空页面临时审计与候选结果；不修改快照、回测输入或本地数据。 |

## 业务规则执行

| 业务规则 | 执行方法 | 执行方式 | 失败结果 |
|---|---|---|---|
| [审计结论边界](../requirements.md#业务规则) | `generate()` | 审计算法只输出审计报告；候选算法显示假设、身份和限制。 | 不创建购票候选。 |
| [滚动回测窗口](../requirements.md#业务规则) | `runBacktest()` | 按冻结时间顺序使用最近 160 期训练窗口，最多评估最近 180 期。 | 数据不足时生成零评估期研究报告。 |
| [验证门槛](../requirements.md#业务规则) | `runBacktest()` / `generate()` | 按评估期和 95% 下界生成 `candidateTier` 与 `validationMessage`；未通过仍生成自身研究候选。 | 不产生“提高中奖概率”断言。 |
| [评分集成](../requirements.md#业务规则) | `runBacktest()` / `generate()` | 回测期使用此前期的非负表现权重；未来候选使用已完成报告的最终权重。 | 无历史表现时等权研究组合。 |
| [五组覆盖结构](../requirements.md#业务规则) | `generate()` | 先生成 5 个锚点，再按算法候补权重派生同红备用蓝票和五红替换票，保存证明过程。 | `calculation-failure` |
| [十五注唯一性](../requirements.md#业务规则) | `generate()` | 通过组合键去重，直到 5 组的 15 注互不相同。 | `calculation-failure` |
| [概率表述](../requirements.md#业务规则) | 算法目录、回测与批次生成 | 输出不包含提高中奖概率的承诺。 | 不适用。 |

## 旧快照与备份兼容

- `PredictionBatch` 的新增字段只要求新生成批次写入；当前 IndexedDB 中的旧快照与 v1 JSON 备份仍允许缺少 `candidateTier`、`validationMessage` 和 `backtestMetric`。
- 读取或导入旧快照时，视图模块默认映射为：

```ts
candidateTier: 'research'
validationMessage: '历史快照生成时未提供冻结回测证据。'
backtestMetric: null
```

- 旧快照原有 `fallbackReason` 仅作为历史文本保留；不得把它解释为当前算法的回退策略。
- `BackupDocument.version` 保持 `1`，新增批次字段为向后兼容的可选 JSON 字段；导出时写入当前完整字段，导入时同时支持旧字段缺失的 v1 文档。

## 代码映射

| 代码项 | 路径与符号 |
|---|---|
| 单元入口与类型 | `src/views/lottery-probability-lab/units/prediction/index.ts#usePredictionUnit` · `PredictionUnit` · `runBacktest` · `generate` |
| 回测与候选算法 | `src/views/lottery-probability-lab/units/prediction/algorithms.ts#generateCombinations` · `equalEnsembleWeights` |
