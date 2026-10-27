<script setup lang="ts">
import { computed } from "vue";
import type {
  CombinationEvaluation,
  PredictionEvaluation,
  PredictionSnapshot,
  PrizeCoverageTicket,
  ReviewStatistics,
} from "../types";

const props = defineProps<{
  snapshots: readonly PredictionSnapshot[];
  evaluations: readonly PredictionEvaluation[];
  statistics: ReviewStatistics;
}>();

const recentSnapshots = computed(() =>
  [...props.snapshots].reverse().slice(0, 6),
);
const evaluationsBySnapshot = computed(
  () =>
    new Map(
      props.evaluations.map((evaluation) => [
        evaluation.snapshotId,
        evaluation,
      ]),
    ),
);
const formatNumber = (number: number) => String(number).padStart(2, "0");
const formatProbability = (probability: number) =>
  `${(probability * 100).toFixed(6)}%`;
const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
const getEvaluation = (snapshotId: string): PredictionEvaluation | undefined =>
  evaluationsBySnapshot.value.get(snapshotId);
const roleLabel = (ticket: PrizeCoverageTicket) =>
  ticket.role === "first-anchor"
    ? "一等奖锚点"
    : ticket.role === "second-blue-cover"
      ? "二等奖蓝球覆盖"
      : "三等奖红球覆盖";
const ticketFlatIndex = (ticket: PrizeCoverageTicket) =>
  (ticket.groupIndex - 1) * 3 +
  (ticket.role === "first-anchor"
    ? 0
    : ticket.role === "second-blue-cover"
      ? 1
      : 2);
const ticketEvaluation = (
  snapshot: PredictionSnapshot,
  ticket: PrizeCoverageTicket,
): CombinationEvaluation | undefined =>
  getEvaluation(snapshot.id)?.results[ticketFlatIndex(ticket)];
const prizeLabel = (result: CombinationEvaluation | undefined) =>
  result?.prizeTier ?? result?.label ?? "等待首个后续开奖";

const algorithmLabel = (algorithmId: PredictionSnapshot["algorithmId"]) => {
  const labels: Record<PredictionSnapshot["algorithmId"], string> = {
    "uniform-baseline": "均匀组合基准",
    "bayesian-static": "贝叶斯静态偏差",
    "time-decay": "时间衰减",
    "pair-dependence": "组合依赖",
    "scored-ensemble": "滚动评分集成",
    "coverage-optimizer": "三注覆盖优化",
  };
  return labels[algorithmId];
};

const candidateLabel = (snapshot: PredictionSnapshot) =>
  snapshot.candidateTier === "validated"
    ? "回测通过覆盖快照"
    : snapshot.candidateTier === "baseline"
      ? "均匀基准覆盖快照"
      : "研究覆盖快照";
</script>

<template>
  <section class="ledger-panel">
    <div class="ledger-heading">
      <div>
        <p class="section-kicker">PREDICTION LEDGER</p>
        <h2>预测快照与开奖复盘</h2>
      </div>
      <el-tag type="success" effect="plain"
        >{{ statistics.evaluatedSnapshotCount }} /
        {{ statistics.snapshotCount }} 已对照</el-tag
      >
    </div>
    <div class="probability-strip">
      <div>
        <span>单注一等奖理论概率</span><strong>1 / 17,721,088</strong
        ><small>{{
          formatProbability(statistics.singleJackpotProbability)
        }}</small>
      </div>
      <div>
        <span>十五注不同组合理论概率</span><strong>15 / 17,721,088</strong
        ><small>{{
          formatProbability(statistics.fifteenTicketJackpotProbability)
        }}</small>
      </div>
      <div>
        <span>已对照候选</span
        ><strong>{{ statistics.evaluatedTicketCount }}</strong
        ><small
          >蓝球命中 {{ statistics.blueHitCount }} 次 · 最多中
          {{ statistics.bestRedHitCount }} 红</small
        >
      </div>
    </div>
    <el-alert
      class="ledger-boundary"
      type="info"
      :closable="false"
      show-icon
      title="一等奖、二等奖、三等奖覆盖票描述票面条件关系；理论概率和本地历史命中统计必须分开理解，不构成未来中奖承诺。"
    />

    <el-empty
      v-if="!recentSnapshots.length"
      description="生成五大组覆盖候选后，会在这里保存不可变快照并等待后续开奖对照。"
      :image-size="72"
    />
    <div v-else class="snapshot-list">
      <article
        v-for="snapshot in recentSnapshots"
        :key="snapshot.id"
        class="snapshot-card"
      >
        <div class="snapshot-head">
          <div>
            <strong
              >{{ algorithmLabel(snapshot.algorithmId) }} ·
              {{ candidateLabel(snapshot) }}</strong
            ><span
              >数据截止：{{ snapshot.sourceLatestIssue }} ·
              {{ snapshot.sourceLatestDate }} ·
              {{
                snapshot.coverageGroups.length
                  ? "5 组 / 15 注"
                  : `${snapshot.combinations.length} 注历史快照`
              }}</span
            >
          </div>
          <time>{{ formatDateTime(snapshot.recordedAt) }}</time>
        </div>

        <div v-if="snapshot.coverageGroups.length" class="ledger-groups">
          <section
            v-for="group in snapshot.coverageGroups"
            :key="group.groupIndex"
            class="ledger-group"
          >
            <div class="group-heading">
              <b>大组 {{ String(group.groupIndex).padStart(2, "0") }}</b
              ><span>条件覆盖：6+1 / 6+0 / 5+1</span>
            </div>
            <div
              v-for="ticket in [
                group.firstPrizeAnchor,
                group.secondPrizeBlueCover,
                group.thirdPrizeRedCover,
              ]"
              :key="ticket.role"
              class="ledger-ticket"
              :class="ticket.role"
            >
              <div class="ticket-meta">
                <b>{{ roleLabel(ticket) }}</b
                ><small>{{
                  ticket.role === "first-anchor"
                    ? "6 红 + 主蓝"
                    : ticket.role === "second-blue-cover"
                      ? "同 6 红 + 备用蓝"
                      : "保留 5 红 + 主蓝"
                }}</small>
              </div>
              <div class="balls">
                <i
                  v-for="red in ticket.redNumbers"
                  :key="red"
                  class="ball red"
                  >{{ formatNumber(red) }}</i
                ><i class="ball blue">{{ formatNumber(ticket.blueNumber) }}</i>
              </div>
              <span
                class="result-label"
                :class="{
                  hit: Boolean(ticketEvaluation(snapshot, ticket)?.prizeTier),
                }"
                >{{ prizeLabel(ticketEvaluation(snapshot, ticket)) }}</span
              >
            </div>
            <details class="ledger-proof">
              <summary>本组证明过程</summary>
              <ul>
                <li
                  v-for="step in group.proofSteps"
                  :key="`${step.label}-${step.value}`"
                >
                  <b>{{ step.label }}：</b>{{ step.value
                  }}<small>{{ step.detail }}</small>
                </li>
              </ul>
            </details>
          </section>
        </div>

        <div v-else class="legacy-tickets">
          <div
            v-for="(combination, index) in snapshot.combinations"
            :key="`${snapshot.id}-${index}`"
            class="ledger-ticket"
          >
            <div class="ticket-meta">
              <b>历史候选 {{ index + 1 }}</b
              ><small>旧版三注快照</small>
            </div>
            <div class="balls">
              <i
                v-for="red in combination.redNumbers"
                :key="red"
                class="ball red"
                >{{ formatNumber(red) }}</i
              ><i class="ball blue">{{
                formatNumber(combination.blueNumber)
              }}</i>
            </div>
            <span class="result-label">{{
              getEvaluation(snapshot.id)?.results[index]?.prizeTier ??
              getEvaluation(snapshot.id)?.results[index]?.label ??
              "等待首个后续开奖"
            }}</span>
          </div>
        </div>
        <div v-if="getEvaluation(snapshot.id)" class="draw-result">
          对照第 <b>{{ getEvaluation(snapshot.id)?.drawIssue }}</b> 期（{{
            getEvaluation(snapshot.id)?.drawDate
          }}）开奖结果
        </div>
        <p class="validation-text">{{ snapshot.validationMessage }}</p>
        <p v-if="snapshot.fallbackReason" class="legacy-note">
          历史说明：{{ snapshot.fallbackReason }}
        </p>
      </article>
    </div>
  </section>
</template>

<style scoped lang="less">
.ledger-panel {
  padding: 21px;
  background: var(--app-surface-color);
  border: 1px solid var(--app-border-color);
  border-radius: var(--app-radius-large);
  box-shadow: var(--app-shadow-card);
}
.ledger-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.section-kicker {
  margin: 0 0 4px;
  color: var(--app-brand-color);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1px;
}
.ledger-heading h2 {
  margin: 0;
  font-size: 17px;
}
.probability-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  margin: 18px 0 12px;
  overflow: hidden;
  background: var(--app-border-color);
  border: 1px solid var(--app-border-color);
  border-radius: 11px;
}
.probability-strip div {
  display: grid;
  gap: 4px;
  min-height: 84px;
  padding: 13px 14px;
  background: #fbfcff;
}
.probability-strip span,
.probability-strip small {
  color: var(--app-muted-color);
  font-size: 10px;
}
.probability-strip strong {
  color: #203b76;
  font-size: 16px;
}
.ledger-boundary {
  margin-bottom: 12px;
}
.snapshot-list {
  display: grid;
  gap: 10px;
}
.snapshot-card {
  padding: 14px;
  border: 1px solid var(--app-border-color);
  border-radius: 11px;
}
.snapshot-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.snapshot-head strong {
  display: block;
  color: #3a4861;
  font-size: 12px;
}
.snapshot-head span,
.snapshot-head time {
  display: block;
  margin-top: 4px;
  color: var(--app-muted-color);
  font-size: 10px;
}
.snapshot-head time {
  white-space: nowrap;
}
.ledger-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}
.ledger-group {
  padding: 10px;
  background: #fbfcff;
  border: 1px solid #e7edf6;
  border-radius: 9px;
}
.group-heading {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.group-heading b {
  color: #34435c;
  font-size: 11px;
}
.group-heading span {
  color: #8390a2;
  font-size: 9px;
}
.ledger-ticket {
  display: grid;
  grid-template-columns: minmax(85px, 0.85fr) minmax(0, 1.5fr) auto;
  align-items: center;
  gap: 8px;
  padding: 7px 0;
  border-top: 1px dashed #e6ebf2;
}
.ledger-ticket:first-of-type {
  border-top: 0;
}
.ticket-meta {
  display: grid;
  gap: 3px;
}
.ticket-meta b {
  color: #4b5970;
  font-size: 10px;
}
.ticket-meta small {
  color: #9aa5b5;
  font-size: 9px;
}
.first-anchor .ticket-meta b {
  color: #c6384a;
}
.second-blue-cover .ticket-meta b {
  color: #2866c4;
}
.third-red-cover .ticket-meta b {
  color: #a96e1c;
}
.balls {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
}
.ball {
  display: inline-grid;
  width: 19px;
  height: 19px;
  place-items: center;
  color: #fff;
  border-radius: 50%;
  font-size: 8px;
  font-style: normal;
  font-weight: 700;
}
.red {
  background: #e74b5e;
}
.blue {
  background: #3678df;
}
.result-label {
  color: #8994a4;
  font-size: 9px;
  white-space: nowrap;
}
.result-label.hit {
  color: var(--app-success-color);
  font-weight: 800;
}
.ledger-proof {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed #e1e8f2;
}
.ledger-proof summary {
  color: var(--app-brand-color);
  font-size: 9px;
  cursor: pointer;
}
.ledger-proof ul {
  display: grid;
  gap: 4px;
  margin: 7px 0 0;
  padding: 0;
  list-style: none;
}
.ledger-proof li {
  color: #788599;
  font-size: 9px;
  line-height: 1.4;
}
.ledger-proof li b {
  color: #526077;
}
.ledger-proof li small {
  display: block;
  color: #9ba5b4;
}
.legacy-tickets {
  display: grid;
  gap: 6px;
  margin-top: 12px;
}
.draw-result {
  margin-top: 11px;
  padding-top: 9px;
  color: #617087;
  border-top: 1px dashed var(--app-border-color);
  font-size: 10px;
}
.draw-result b {
  color: var(--app-brand-deep);
}
.validation-text {
  margin: 9px 0 0;
  color: #aa7b27;
  font-size: 10px;
  line-height: 1.5;
}
.legacy-note {
  margin: 5px 0 0;
  color: #8d98aa;
  font-size: 10px;
  line-height: 1.5;
}
@media (max-width: 850px) {
  .ledger-groups {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 700px) {
  .probability-strip {
    grid-template-columns: 1fr;
  }
  .snapshot-head {
    flex-direction: column;
    gap: 0;
  }
  .ledger-ticket {
    grid-template-columns: 1fr;
    gap: 5px;
  }
  .result-label {
    padding-left: 0;
  }
}
@media (max-width: 430px) {
  .ledger-panel {
    padding: 16px;
  }
}
</style>
