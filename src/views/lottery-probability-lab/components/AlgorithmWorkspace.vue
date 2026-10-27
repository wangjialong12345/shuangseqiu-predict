<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import type {
  AlgorithmBacktestMetric,
  AlgorithmDefinition,
  AuditReport,
  BacktestReport,
  PredictionBatch,
  PredictionOperationResult,
  PrizeCoverageGroup,
  PrizeCoverageTicket,
} from "../types";

const props = defineProps<{
  algorithm: AlgorithmDefinition;
  totalDraws: number;
  latestIssue: string | null;
  latestDate: string | null;
  currentBatch: PredictionBatch | null;
  currentAudit: AuditReport | null;
  backtest: BacktestReport | null;
  isBacktesting: boolean;
  onGenerate: () => Promise<PredictionOperationResult>;
  onRunBacktest: () => Promise<BacktestReport>;
}>();

const localBacktestRunning = ref(false);
const isAudit = computed(() => props.algorithm.kind === "audit");
const isCurrentBatch = computed(
  () => props.currentBatch?.algorithmId === props.algorithm.id,
);
const isBatchUsingLatestData = computed(() =>
  Boolean(
    props.currentBatch &&
      props.currentBatch.sourceLatestIssue === props.latestIssue &&
      props.currentBatch.sourceLatestDate === props.latestDate,
  ),
);
const currentMetric = computed<AlgorithmBacktestMetric | null>(() => {
  if (props.algorithm.id === "randomness-audit") return null;
  return (
    props.backtest?.metrics.find(
      (metric) => metric.algorithmId === props.algorithm.id,
    ) ?? null
  );
});
const formatNumber = (number: number) => String(number).padStart(2, "0");
const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const formatPercent = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const formatScore = (value: number | null) =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;

const runBacktest = async () => {
  localBacktestRunning.value = true;
  try {
    const report = await props.onRunBacktest();
    ElMessage.success(
      report.evaluationPeriods
        ? `已完成 ${report.evaluationPeriods} 个冻结预测期回测。`
        : "数据不足 161 期，已生成研究状态报告。",
    );
  } catch {
    ElMessage.error("滚动回测计算失败，请稍后重试。");
  } finally {
    localBacktestRunning.value = false;
  }
};

const generate = async () => {
  const result = await props.onGenerate();
  if (!result.ok) ElMessage.warning(result.error.message);
};

const roleLabel = (ticket: PrizeCoverageTicket) =>
  ticket.role === "first-anchor"
    ? "一等奖锚点票"
    : ticket.role === "second-blue-cover"
      ? "二等奖蓝球覆盖"
      : "三等奖红球覆盖";

const roleDescription = (ticket: PrizeCoverageTicket) =>
  ticket.role === "first-anchor"
    ? "6 红 + 主蓝"
    : ticket.role === "second-blue-cover"
      ? "同 6 红 + 备用蓝"
      : "保留 5 红 + 主蓝 + 1 红替换";

const groupTickets = (group: PrizeCoverageGroup) => [
  group.firstPrizeAnchor,
  group.secondPrizeBlueCover,
  group.thirdPrizeRedCover,
];
</script>

<template>
  <section class="workspace">
    <div class="workspace-intro">
      <div>
        <p class="section-kicker">ACTIVE METHOD</p>
        <h2>{{ algorithm.name }}</h2>
        <p>{{ algorithm.description }}</p>
      </div>
      <el-tag
        :type="
          algorithm.kind === 'audit'
            ? 'warning'
            : algorithm.kind === 'baseline'
              ? 'success'
              : 'info'
        "
        effect="light"
        >{{
          algorithm.kind === "audit"
            ? "审计工具"
            : algorithm.kind === "baseline"
              ? "基准模型"
              : "研究模型"
        }}</el-tag
      >
    </div>
    <p class="method-detail">{{ algorithm.detail }}</p>

    <el-empty
      v-if="!totalDraws"
      description="等待官方历史同步完成后，才能开始审计、回测或生成候选。"
      :image-size="76"
    />

    <template v-else-if="isAudit">
      <div v-if="currentAudit" class="audit-content">
        <div class="metric-grid">
          <article
            v-for="metric in currentAudit.metrics"
            :key="metric.label"
            class="metric-card"
          >
            <span>{{ metric.label }}</span
            ><strong>{{ metric.value }}</strong
            ><small>{{ metric.description }}</small>
          </article>
        </div>
        <div class="audit-bottom">
          <div>
            <h3>近期 {{ currentAudit.recentWindowSize }} 期红球出现较多</h3>
            <div class="balls">
              <i
                v-for="item in currentAudit.recentRedLeaders"
                :key="item.number"
                class="ball red"
                >{{ formatNumber(item.number) }}<em>{{ item.count }}</em></i
              >
            </div>
          </div>
          <div>
            <h3>历史共同出现较多的红球对</h3>
            <div class="pair-list">
              <span
                v-for="pair in currentAudit.frequentPairs"
                :key="`${pair.first}-${pair.second}`"
                >{{ formatNumber(pair.first) }} ·
                {{ formatNumber(pair.second) }} <b>{{ pair.count }}</b></span
              >
            </div>
          </div>
        </div>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          :title="currentAudit.conclusion"
        />
      </div>
      <el-result
        v-else
        icon="info"
        title="尚未运行审计"
        sub-title="审计不生成购票候选，只用于观察历史数据。"
        ><template #extra
          ><el-button type="primary" @click="generate"
            >运行随机性审计</el-button
          ></template
        ></el-result
      >
    </template>

    <template v-else>
      <div class="backtest-panel">
        <div class="backtest-heading">
          <div>
            <p class="section-kicker">FROZEN ROLLING BACKTEST</p>
            <h3>冻结滚动回测</h3>
          </div>
          <el-button
            plain
            type="primary"
            :loading="isBacktesting || localBacktestRunning"
            @click="runBacktest"
            >运行回测</el-button
          >
        </div>
        <p class="backtest-copy">
          每个预测期仅使用此前 160 期数据；最多评估最近 180
          期。研究候选不等于预测优势，只有 95% 下界大于 0 且评估期不少于 120
          才标记为回测通过。
        </p>
        <div v-if="currentMetric" class="backtest-metrics">
          <article>
            <span>评估期</span
            ><strong>{{ currentMetric.evaluationPeriods }}</strong
            ><small
              >{{ backtest?.evaluatedFromIssue ?? "—" }} 至
              {{ backtest?.evaluatedToIssue ?? "—" }}</small
            >
          </article>
          <article>
            <span>平均红球命中 / 注</span
            ><strong>{{
              currentMetric.averageRedHitsPerTicket.toFixed(3)
            }}</strong
            ><small>三注逐期平均</small>
          </article>
          <article>
            <span>蓝球命中率 / 注</span
            ><strong>{{
              formatPercent(currentMetric.blueHitRatePerTicket)
            }}</strong
            ><small>历史回测样本</small>
          </article>
          <article>
            <span>相对基准复合分差</span
            ><strong>{{
              formatScore(currentMetric.meanCompositeScoreDelta)
            }}</strong
            ><small
              >95% 下界
              {{ formatScore(currentMetric.compositeScoreDeltaLower95) }}</small
            >
          </article>
          <article>
            <span>逐期胜率 / 平局</span
            ><strong>{{ formatPercent(currentMetric.periodWinRate) }}</strong
            ><small
              >平局 {{ formatPercent(currentMetric.periodTieRate) }}</small
            >
          </article>
        </div>
        <el-alert
          v-if="currentMetric"
          class="validation-alert"
          :type="
            currentMetric.candidateTier === 'validated'
              ? 'success'
              : currentMetric.candidateTier === 'baseline'
                ? 'info'
                : 'warning'
          "
          :closable="false"
          show-icon
          :title="currentMetric.validationMessage"
        />
        <el-alert
          v-else
          type="info"
          :closable="false"
          show-icon
          title="尚未运行回测。生成候选时也会自动计算当前数据对应的冻结回测。"
        />
      </div>

      <div v-if="isCurrentBatch && currentBatch" class="prediction-content">
        <el-alert
          class="candidate-alert"
          :type="
            currentBatch.candidateTier === 'validated'
              ? 'success'
              : currentBatch.candidateTier === 'baseline'
                ? 'info'
                : 'warning'
          "
          :closable="false"
          show-icon
          :title="currentBatch.validationMessage"
        />
        <div class="batch-meta">
          <span
            >数据截止：<b>{{ currentBatch.sourceLatestIssue }}</b> ·
            {{ currentBatch.sourceLatestDate }}</span
          ><span>生成于 {{ formatDateTime(currentBatch.generatedAt) }}</span>
        </div>
        <div class="coverage-summary">
          <strong>本次生成 5 个奖级覆盖大组，共 15 注。</strong
          ><span
            >每组围绕一个一等奖锚点派生同红备用蓝票与五红主蓝替换票；覆盖关系不改变任一单注概率。</span
          >
        </div>
        <div
          v-if="currentBatch.coverageGroups.length"
          class="coverage-group-grid"
        >
          <article
            v-for="group in currentBatch.coverageGroups"
            :key="group.groupIndex"
            class="coverage-group"
          >
            <div class="group-title">
              <span>大组 {{ String(group.groupIndex).padStart(2, "0") }}</span
              ><small>6+1 / 6+0 / 5+1 条件覆盖</small>
            </div>
            <div class="coverage-tickets">
              <div
                v-for="ticket in groupTickets(group)"
                :key="ticket.role"
                class="coverage-ticket"
                :class="ticket.role"
              >
                <div>
                  <b>{{ roleLabel(ticket) }}</b
                  ><small>{{ roleDescription(ticket) }}</small>
                </div>
                <div class="ticket-balls">
                  <i
                    v-for="red in ticket.redNumbers"
                    :key="red"
                    class="ball red"
                    >{{ formatNumber(red) }}</i
                  ><span class="plus">+</span
                  ><i class="ball blue">{{
                    formatNumber(ticket.blueNumber)
                  }}</i>
                </div>
              </div>
            </div>
            <details class="proof-details">
              <summary>查看本组算法证明过程</summary>
              <ul>
                <li
                  v-for="step in group.proofSteps"
                  :key="`${step.label}-${step.value}`"
                >
                  <b>{{ step.label }}：</b><span>{{ step.value }}</span
                  ><small>{{ step.detail }}</small>
                </li>
              </ul>
            </details>
          </article>
        </div>
        <div v-else class="legacy-ticket-grid">
          <article
            v-for="(combination, index) in currentBatch.combinations"
            :key="`${currentBatch.id}-${index}`"
            class="ticket-card"
          >
            <div class="ticket-title">
              <span>历史候选 {{ String(index + 1).padStart(2, "0") }}</span
              ><small v-if="combination.score !== null"
                >算法分 {{ combination.score }}</small
              ><small v-else>均匀抽样</small>
            </div>
            <div class="ticket-balls">
              <i
                v-for="red in combination.redNumbers"
                :key="red"
                class="ball red"
                >{{ formatNumber(red) }}</i
              ><span class="plus">+</span
              ><i class="ball blue">{{
                formatNumber(combination.blueNumber)
              }}</i>
            </div>
          </article>
        </div>
        <el-alert
          class="next-batch-alert"
          :type="isBatchUsingLatestData ? 'info' : 'success'"
          :closable="false"
          show-icon
          :title="
            isBatchUsingLatestData
              ? `当前批次已使用最新官方数据（第 ${latestIssue ?? '—'} 期 · ${latestDate ?? '—'}）。它用于预测下一次官方开奖；再次生成只会使用相同数据截止期创建不同固定种子的独立快照，不代表获得新信息。`
              : `官方数据已更新到第 ${latestIssue ?? '—'} 期 · ${latestDate ?? '—'}，当前快照仍截至第 ${currentBatch.sourceLatestIssue ?? '—'} 期。现在可生成下一次官方开奖的五大组。`
          "
        />
        <div class="next-batch-actions">
          <el-button type="primary" @click="generate"
            >基于当前数据生成新一批五大组</el-button
          >
          <span>旧快照会保留在预测账本中，并在开奖后继续参与对照。</span>
        </div>
        <p class="saved-note">
          本批次已保存为不可变 5 组 / 15
          注预测快照；后续首个官方开奖会自动逐注对照并标记 `6+1 / 6+0 / 5+1`。
        </p>
      </div>
      <el-result
        v-else
        icon="info"
        title="尚未生成当前算法的覆盖候选"
        :sub-title="`当前已有 ${totalDraws} 期数据。算法会先使用冻结回测标注候选身份，再输出 5 个大组、15 注和每组的证明过程。`"
        ><template #extra
          ><el-button type="primary" @click="generate"
            >按此算法计算五大组</el-button
          ></template
        ></el-result
      >
    </template>
  </section>
</template>

<style scoped lang="less">
.workspace {
  padding: 22px;
  background: var(--app-surface-color);
  border: 1px solid var(--app-border-color);
  border-radius: var(--app-radius-large);
  box-shadow: var(--app-shadow-card);
}
.workspace-intro,
.backtest-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}
.section-kicker {
  margin: 0 0 5px;
  color: var(--app-brand-color);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1px;
}
.workspace h2,
.workspace h3 {
  margin: 0;
  font-size: 19px;
}
.workspace h3 {
  font-size: 14px;
}
.workspace-intro p:not(.section-kicker) {
  max-width: 680px;
  margin: 7px 0 0;
  color: var(--app-muted-color);
  font-size: 13px;
  line-height: 1.6;
}
.method-detail,
.backtest-copy {
  margin: 15px 0 20px;
  padding: 10px 12px;
  color: #53617a;
  background: var(--app-surface-soft-color);
  border: 1px solid #edf1f8;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
}
.backtest-panel {
  margin: 0 0 17px;
  padding: 15px;
  background: #fbfcff;
  border: 1px solid #e8eef8;
  border-radius: 12px;
}
.backtest-copy {
  margin: 10px 0;
  padding: 0;
  background: transparent;
  border: 0;
}
.backtest-metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}
.backtest-metrics article {
  display: grid;
  gap: 4px;
  min-height: 85px;
  padding: 10px;
  background: #fff;
  border: 1px solid #e7edf7;
  border-radius: 9px;
}
.backtest-metrics span,
.backtest-metrics small {
  color: var(--app-muted-color);
  font-size: 10px;
  line-height: 1.4;
}
.backtest-metrics strong {
  color: var(--app-brand-deep);
  font-size: 17px;
}
.validation-alert,
.candidate-alert,
.next-batch-alert {
  margin-top: 11px;
}
.next-batch-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding: 10px 0;
}
.next-batch-actions span {
  color: var(--app-muted-color);
  font-size: 10px;
  line-height: 1.5;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.metric-card {
  display: grid;
  gap: 6px;
  min-height: 118px;
  padding: 14px;
  background: linear-gradient(145deg, #fbfcff, #f2f6ff);
  border: 1px solid #e8eefb;
  border-radius: 12px;
}
.metric-card span {
  color: #5f6d84;
  font-size: 11px;
}
.metric-card strong {
  color: var(--app-brand-deep);
  font-size: 22px;
}
.metric-card small {
  color: var(--app-muted-color);
  font-size: 10px;
  line-height: 1.5;
}
.audit-bottom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin: 18px 0;
}
.audit-bottom h3 {
  margin: 0 0 10px;
  color: #435169;
  font-size: 12px;
}
.balls,
.ticket-balls {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ball {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  color: #fff;
  border-radius: 50%;
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
}
.red {
  position: relative;
  background: linear-gradient(135deg, #ff6877, #d72d45);
}
.blue {
  background: linear-gradient(135deg, #5598f3, #245fca);
}
.ball em {
  position: absolute;
  right: -3px;
  bottom: -3px;
  display: grid;
  min-width: 13px;
  height: 13px;
  place-items: center;
  color: #a92a3a;
  background: #fff;
  border: 1px solid #f0c5cb;
  border-radius: 50%;
  font-size: 8px;
  font-style: normal;
}
.pair-list {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}
.pair-list span {
  padding: 7px 8px;
  color: #58667d;
  background: #f7f9fd;
  border: 1px solid #e9eef6;
  border-radius: 7px;
  font-size: 11px;
}
.pair-list b {
  margin-left: 3px;
  color: var(--app-brand-color);
}
.batch-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--app-muted-color);
  font-size: 11px;
}
.batch-meta b {
  color: var(--app-text-color);
}
.coverage-summary {
  display: grid;
  gap: 3px;
  margin: 0 0 12px;
  padding: 11px 12px;
  color: #596880;
  background: #f7f9fd;
  border: 1px solid #e7edf7;
  border-radius: 9px;
  font-size: 11px;
  line-height: 1.5;
}
.coverage-summary strong {
  color: var(--app-brand-deep);
}
.coverage-group-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.coverage-group {
  padding: 13px;
  border: 1px solid var(--app-border-color);
  border-radius: 12px;
  background: linear-gradient(145deg, #fff, #f7f9fd);
}
.group-title {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 11px;
}
.group-title span {
  color: #35445e;
  font-size: 12px;
  font-weight: 800;
}
.group-title small {
  color: var(--app-muted-color);
  font-size: 9px;
  text-align: right;
}
.coverage-tickets {
  display: grid;
  gap: 8px;
}
.coverage-ticket {
  display: grid;
  gap: 6px;
  padding: 8px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #edf1f6;
}
.coverage-ticket > div:first-child {
  display: flex;
  justify-content: space-between;
  gap: 7px;
}
.coverage-ticket b {
  color: #4b5870;
  font-size: 10px;
}
.coverage-ticket small {
  color: #8a96a8;
  font-size: 9px;
}
.coverage-ticket.first-anchor {
  border-left: 3px solid #e34559;
}
.coverage-ticket.second-blue-cover {
  border-left: 3px solid #3678df;
}
.coverage-ticket.third-red-cover {
  border-left: 3px solid #d7902d;
}
.plus {
  color: #a5afbe;
  font-weight: 700;
}
.proof-details {
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px dashed var(--app-border-color);
}
.proof-details summary {
  color: var(--app-brand-color);
  font-size: 10px;
  cursor: pointer;
}
.proof-details ul {
  display: grid;
  gap: 6px;
  margin: 9px 0 0;
  padding: 0;
  list-style: none;
}
.proof-details li {
  display: grid;
  gap: 2px;
  color: #69778d;
  font-size: 10px;
  line-height: 1.45;
}
.proof-details li b {
  color: #43516a;
}
.proof-details li span {
  color: var(--app-brand-deep);
}
.proof-details li small {
  color: #8c98a9;
}
.legacy-ticket-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.ticket-card {
  padding: 15px;
  background: linear-gradient(145deg, #fff, #f7f9fd);
  border: 1px solid var(--app-border-color);
  border-radius: 12px;
}
.ticket-title {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 15px;
}
.ticket-title span {
  color: #394864;
  font-size: 12px;
  font-weight: 700;
}
.ticket-title small {
  color: var(--app-muted-color);
  font-size: 10px;
}
.saved-note {
  margin: 14px 0 0;
  color: var(--app-success-color);
  font-size: 11px;
}
@media (max-width: 1100px) {
  .backtest-metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 900px) {
  .coverage-group-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 840px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .legacy-ticket-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 560px) {
  .workspace {
    padding: 17px;
  }
  .workspace-intro,
  .backtest-heading {
    flex-direction: column;
  }
  .backtest-metrics {
    grid-template-columns: 1fr;
  }
  .audit-bottom {
    grid-template-columns: 1fr;
  }
  .batch-meta {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }
  .group-title {
    flex-direction: column;
  }
  .next-batch-actions {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
