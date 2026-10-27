# 双色球概率实验室 - 复盘单元技术设计

页面稳定代码骨架：[页面技术设计](../technical-design.md)

## 单元职责

复盘单元拥有不可变预测快照、IndexedDB 保存、未对照快照与首个后续开奖的绑定、每注命中结构和理论 / 经验统计摘要。它不重新计算或修改候选批次。

## 单元入口

| 项目 | 名称或签名 | 作用 |
|---|---|---|
| 入口函数 | `useReviewUnit(): ReviewUnit` | 创建预测快照和开奖复盘工作流。 |
| 对外类型 | `ReviewUnit` | 暴露快照、对照记录、统计和操作。 |

```ts
function useReviewUnit(): ReviewUnit

interface ReviewUnit {
  readonly state: Readonly<ReviewState>
  initialize(): Promise<RestoreResult>
  recordBatch(batch: PredictionBatch): Promise<ReviewOperationResult>
  reconcile(draws: readonly DrawRecord[]): Promise<ReviewOperationResult>
  replaceAll(snapshots: readonly PredictionSnapshot[], evaluations: readonly PredictionEvaluation[]): Promise<ReviewOperationResult>
  dispose(): void
}
```

## 状态结构

```ts
interface ReviewState {
  snapshots: readonly PredictionSnapshot[]
  evaluations: readonly PredictionEvaluation[]
  statistics: ReviewStatistics
  lastOperationMessage: string | null
}
```

| 状态 | 初始值 | 含义 |
|---|---|---|
| `snapshots` | `[]` | 已保存且不可变的预测批次。 |
| `evaluations` | `[]` | 快照与对应开奖的每注命中结果。 |
| `statistics` | 零值统计 | 理论概率、快照数、已对照数和命中分布。 |
| `lastOperationMessage` | `null` | 最近保存或对照结果。 |

## 输入、输出与错误类型

```ts
interface PredictionSnapshot extends PredictionBatch {
  recordedAt: string
}

interface PredictionEvaluation {
  snapshotId: string
  drawIssue: string
  drawDate: string
  results: readonly CombinationEvaluation[]
}

type PrizeTier = '一等奖' | '二等奖' | '三等奖'

interface CombinationEvaluation {
  redHitCount: number
  blueHit: boolean
  label: string
  prizeTier: PrizeTier | null
}

type ReviewOperationResult =
  | { ok: true; value: PredictionSnapshot | readonly PredictionEvaluation[] }
  | { ok: false; error: ReviewError }

type ReviewError =
  | { type: 'storage-failure'; message: string }
  | { type: 'invalid-batch'; message: string }
```

## 方法行为

| 方法 | 前置条件 | 状态变化 | 成功结果 | 失败结果 |
|---|---|---|---|---|
| `initialize()` | IndexedDB 已打开。 | 从 `predictionSnapshots` 和 `evaluations` 对象仓恢复合法数据，重算统计。 | 返回恢复结果。 | 保留现有内存状态并返回警告。 |
| `recordBatch(batch)` | 批次含三注合法且互异组合。 | 将批次复制为不可变快照，通过 IndexedDB 保存并重算统计。 | 返回保存后的快照。 | `invalid-batch` 或 `storage-failure`；历史状态不变。 |
| `reconcile(draws)` | 已有快照和合法开奖记录。 | 为符合条件且尚未对照的 15 注覆盖票写入首个后续开奖的对照结果，通过 IndexedDB 保存并重算统计。 | 返回新建对照记录；`6+1 / 6+0 / 5+1` 分别标注一等奖 / 二等奖 / 三等奖。 | `storage-failure`；已有快照不变。 |
| `replaceAll(snapshots, evaluations)` | 调用方已完整校验备份关系。 | 用传入数据完整替换两个对象仓并重算统计。 | 返回恢复后的对照记录。 | `invalid-batch` 或 `storage-failure`，当前状态不发生部分替换。 |

## 并发与生命周期

| 场景 | 处理方式 |
|---|---|
| 重复调用 | 对已绑定开奖的快照保持幂等；不生成第二个对照。 |
| 并发结果 | 同步顺序执行，保存后立即更新统计。 |
| 释放 | 不保留异步任务或订阅。 |

## 业务规则执行

| 业务规则 | 执行方法 | 执行方式 | 失败结果 |
|---|---|---|---|
| [预测快照不可变](../requirements.md#业务规则) | `recordBatch()` | 深复制批次；不提供修改或覆写入口。 | `invalid-batch` |
| [开奖对照规则](../requirements.md#业务规则) | `reconcile()` | 找到数据截止日期后的第一条开奖记录并仅绑定一次；按每注的 `6+1 / 6+0 / 5+1` 标注一等奖 / 二等奖 / 三等奖。 | 不生成重复对照。 |
| [概率表述](../requirements.md#业务规则) | 统计重算 | 将理论概率与经验样本数、命中分布分别返回。 | 不适用。 |
| [本地数据边界](../requirements.md#业务规则) | 所有保存方法 | 仅通过页面私有 IndexedDB 存储入口读写 `predictionSnapshots` 和 `evaluations` 对象仓。 | `storage-failure` |

## 代码映射

| 代码项 | 路径与符号 |
|---|---|
| 单元入口与类型 | `src/views/lottery-probability-lab/units/review/index.ts#useReviewUnit` · `ReviewUnit` |
