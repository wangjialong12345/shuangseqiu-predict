<script setup lang="ts">
import { computed } from "vue";
import type { BallFrequency, DrawRecord, DrawSummary } from "../types";

const props = defineProps<{
  summary: DrawSummary;
  draws: readonly DrawRecord[];
}>();

const recentDraws = computed(() => [...props.draws].slice(-5).reverse());
const redLeaders = computed(() =>
  rankFrequencies(props.summary.redFrequencies, 12),
);
const blueLeaders = computed(() =>
  rankFrequencies(props.summary.blueFrequencies, 8),
);
const highestRedCount = computed(() =>
  Math.max(1, ...props.summary.redFrequencies.map((item) => item.count)),
);
const highestBlueCount = computed(() =>
  Math.max(1, ...props.summary.blueFrequencies.map((item) => item.count)),
);

const formatNumber = (number: number) => String(number).padStart(2, "0");
const barWidth = (item: BallFrequency, maximum: number) =>
  `${Math.max(8, (item.count / maximum) * 100)}%`;

function rankFrequencies(frequencies: readonly BallFrequency[], limit: number) {
  return [...frequencies]
    .sort(
      (left, right) => right.count - left.count || left.number - right.number,
    )
    .slice(0, limit);
}
</script>

<template>
  <section class="overview-grid">
    <el-card shadow="never" class="section-card history-card">
      <template #header
        ><div class="card-heading">
          <div>
            <p class="section-kicker">LOCAL DRAW DATA</p>
            <h2>开奖记录概览</h2>
          </div>
          <el-tag effect="plain" type="info">浏览器本地保存</el-tag>
        </div></template
      >
      <el-empty
        v-if="!summary.totalDraws"
        description="尚未录入开奖数据。可从顶部新增一期或粘贴 CSV。"
        :image-size="72"
      />
      <template v-else>
        <div class="summary-ribbon">
          <div>
            <span>最新期号</span
            ><strong>{{ summary.latestDraw?.issue }}</strong>
          </div>
          <div>
            <span>开奖日期</span><strong>{{ summary.latestDraw?.date }}</strong>
          </div>
          <div>
            <span>数据量</span
            ><strong>{{ summary.totalDraws }} <small>期</small></strong>
          </div>
        </div>
        <div class="recent-list">
          <div v-for="draw in recentDraws" :key="draw.issue" class="draw-row">
            <div class="draw-meta">
              <strong>{{ draw.issue }}</strong
              ><span>{{ draw.date }}</span>
            </div>
            <div class="balls">
              <i
                v-for="red in draw.redNumbers"
                :key="`r-${red}`"
                class="ball red"
                >{{ formatNumber(red) }}</i
              ><i class="ball blue">{{ formatNumber(draw.blueNumber) }}</i>
            </div>
          </div>
        </div>
      </template>
    </el-card>

    <el-card shadow="never" class="section-card frequency-card">
      <template #header
        ><div class="card-heading">
          <div>
            <p class="section-kicker">FREQUENCY SNAPSHOT</p>
            <h2>号码分布</h2>
          </div>
          <span class="card-note">仅描述历史，不表示下期概率</span>
        </div></template
      >
      <el-empty
        v-if="!summary.totalDraws"
        description="导入数据后显示红蓝球频率。"
        :image-size="72"
      />
      <template v-else
        ><div class="frequency-columns">
          <div class="frequency-column">
            <h3><span class="dot red-dot"></span>红球出现次数</h3>
            <div
              v-for="item in redLeaders"
              :key="item.number"
              class="frequency-item"
            >
              <span class="number-label">{{ formatNumber(item.number) }}</span>
              <div class="bar-track">
                <i :style="{ width: barWidth(item, highestRedCount) }"></i>
              </div>
              <strong>{{ item.count }}</strong>
            </div>
          </div>
          <div class="frequency-column blue-column">
            <h3><span class="dot blue-dot"></span>蓝球出现次数</h3>
            <div
              v-for="item in blueLeaders"
              :key="item.number"
              class="frequency-item"
            >
              <span class="number-label">{{ formatNumber(item.number) }}</span>
              <div class="bar-track">
                <i :style="{ width: barWidth(item, highestBlueCount) }"></i>
              </div>
              <strong>{{ item.count }}</strong>
            </div>
          </div>
        </div></template
      >
    </el-card>
  </section>
</template>

<style scoped lang="less">
.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  gap: 18px;
}
.section-card {
  height: 100%;
  border-radius: var(--app-radius-large);
  box-shadow: var(--app-shadow-card);
}
.section-card :deep(.el-card__header) {
  padding: 17px 20px 14px;
  border-bottom-color: var(--app-border-color);
}
.section-card :deep(.el-card__body) {
  padding: 16px 20px 20px;
}
.card-heading {
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
.card-heading h2 {
  margin: 0;
  font-size: 16px;
}
.card-note {
  color: var(--app-muted-color);
  font-size: 11px;
  text-align: right;
}
.summary-ribbon {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin-bottom: 10px;
  padding: 13px 0;
  background: var(--app-surface-soft-color);
  border: 1px solid #eef2f9;
  border-radius: 10px;
}
.summary-ribbon div {
  padding: 0 14px;
  border-right: 1px solid var(--app-border-color);
}
.summary-ribbon div:last-child {
  border: 0;
}
.summary-ribbon span {
  display: block;
  color: var(--app-muted-color);
  font-size: 11px;
}
.summary-ribbon strong {
  display: block;
  margin-top: 4px;
  color: var(--app-brand-deep);
  font-size: 15px;
}
.summary-ribbon small {
  color: var(--app-muted-color);
  font-size: 11px;
  font-weight: 500;
}
.recent-list {
  display: grid;
  gap: 2px;
}
.draw-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 4px;
  border-bottom: 1px dashed var(--app-border-color);
}
.draw-row:last-child {
  border-bottom: 0;
}
.draw-meta {
  display: grid;
  min-width: 91px;
  gap: 3px;
}
.draw-meta strong {
  color: #334361;
  font-size: 13px;
}
.draw-meta span {
  color: var(--app-muted-color);
  font-size: 11px;
}
.balls {
  display: flex;
  justify-content: flex-end;
  gap: 5px;
  flex-wrap: wrap;
}
.ball {
  display: inline-grid;
  width: 23px;
  height: 23px;
  place-items: center;
  color: #fff;
  border-radius: 50%;
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
}
.red {
  background: linear-gradient(135deg, #ff6877, #d72d45);
}
.blue {
  background: linear-gradient(135deg, #5598f3, #245fca);
}
.frequency-columns {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 23px;
}
.frequency-column h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 11px;
  color: #4c5a71;
  font-size: 12px;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.red-dot {
  background: var(--app-danger-color);
}
.blue-dot {
  background: var(--app-blue-color);
}
.frequency-item {
  display: grid;
  grid-template-columns: 25px 1fr 22px;
  align-items: center;
  gap: 7px;
  margin: 7px 0;
}
.number-label {
  color: #5f6d84;
  font-size: 11px;
  font-weight: 700;
}
.bar-track {
  height: 6px;
  overflow: hidden;
  background: #f0f3f8;
  border-radius: 99px;
}
.bar-track i {
  display: block;
  height: 100%;
  min-width: 4px;
  background: linear-gradient(90deg, #ff8c97, #e34559);
  border-radius: inherit;
}
.blue-column .bar-track i {
  background: linear-gradient(90deg, #7caff7, #2e70d9);
}
.frequency-item strong {
  color: #5d6a80;
  font-size: 11px;
  text-align: right;
}
@media (max-width: 780px) {
  .overview-grid {
    grid-template-columns: 1fr;
  }
  .frequency-columns {
    grid-template-columns: 1fr;
    gap: 18px;
  }
  .blue-column {
    padding-top: 14px;
    border-top: 1px dashed var(--app-border-color);
  }
}
@media (max-width: 440px) {
  .summary-ribbon div {
    padding: 0 8px;
  }
  .summary-ribbon strong {
    font-size: 13px;
  }
  .draw-row {
    align-items: flex-start;
    flex-direction: column;
  }
  .balls {
    justify-content: flex-start;
  }
}
</style>
