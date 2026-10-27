<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import AlgorithmSidebar from "./components/AlgorithmSidebar.vue";
import AlgorithmWorkspace from "./components/AlgorithmWorkspace.vue";
import DataOverviewPanel from "./components/DataOverviewPanel.vue";
import LotteryHeader from "./components/LotteryHeader.vue";
import PredictionLedgerPanel from "./components/PredictionLedgerPanel.vue";
import { useLotteryProbabilityLabViewModule } from "./module";

const lab = useLotteryProbabilityLabViewModule();
const activeAlgorithm = computed(
  () =>
    lab.prediction.state.algorithms.find(
      (algorithm) => algorithm.id === lab.state.activeAlgorithmId,
    ) ?? lab.prediction.state.algorithms[0],
);

onMounted(() => {
  void lab.initialize();
});
onBeforeUnmount(() => lab.dispose());
</script>

<template>
  <main class="lottery-lab-page">
    <LotteryHeader
      :summary="lab.drawData.state.summary"
      :official-sync="lab.drawData.state.officialSync"
      :automatic-sync="lab.state.automaticSync"
      :statistics="lab.review.state.statistics"
      :on-import-csv="lab.importDrawCsv"
      :on-generate="lab.generatePrediction"
      :on-export-backup="lab.exportBackup"
      :on-import-backup="lab.importBackup"
    />

    <el-alert
      v-if="lab.state.restoreWarning"
      class="restore-warning"
      type="warning"
      show-icon
      :closable="false"
      :title="lab.state.restoreWarning"
    />

    <div class="lab-layout">
      <div class="main-column">
        <DataOverviewPanel
          :summary="lab.drawData.state.summary"
          :draws="lab.drawData.state.draws"
        />
        <AlgorithmWorkspace
          :algorithm="activeAlgorithm"
          :total-draws="lab.drawData.state.summary.totalDraws"
          :current-batch="lab.prediction.state.currentBatch"
          :current-audit="lab.prediction.state.currentAudit"
          :backtest="lab.prediction.state.backtest"
          :is-backtesting="lab.prediction.state.isBacktesting"
          :on-generate="lab.generatePrediction"
          :on-run-backtest="lab.runRollingBacktest"
        />
        <PredictionLedgerPanel
          :snapshots="lab.review.state.snapshots"
          :evaluations="lab.review.state.evaluations"
          :statistics="lab.review.state.statistics"
        />
      </div>
      <div class="sidebar-column">
        <AlgorithmSidebar
          :algorithms="lab.prediction.state.algorithms"
          :active-algorithm-id="lab.state.activeAlgorithmId"
          :on-select="lab.selectAlgorithm"
        />
      </div>
    </div>
  </main>
</template>

<style scoped lang="less">
.lottery-lab-page {
  min-height: 100vh;
  padding: var(--app-content-padding);
  background: radial-gradient(circle at 100% 0%, #edf4ff 0, transparent 27%),
    var(--app-content-bg-color);
}
.restore-warning {
  max-width: 1380px;
  margin: 16px auto 0;
}
.lab-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--app-sidebar-width);
  gap: 20px;
  max-width: 1380px;
  margin: 20px auto 0;
}
.lottery-lab-page > :deep(.lab-header) {
  max-width: 1380px;
  margin: 0 auto;
}
.main-column {
  display: grid;
  align-content: start;
  gap: 18px;
  min-width: 0;
}
.sidebar-column {
  min-width: 0;
}
.sidebar-column :deep(.algorithm-sidebar) {
  position: sticky;
  top: 18px;
}
@media (max-width: 1050px) {
  .lab-layout {
    grid-template-columns: 1fr;
  }
  .sidebar-column :deep(.algorithm-sidebar) {
    position: static;
  }
  .sidebar-column {
    order: -1;
  }
  .sidebar-column :deep(nav) {
    display: flex;
    gap: 4px;
    overflow-x: auto;
  }
  .sidebar-column :deep(button) {
    min-width: 150px;
  }
  .sidebar-column :deep(.sidebar-footnote) {
    display: none;
  }
}
@media (max-width: 600px) {
  .lottery-lab-page {
    padding: 12px;
  }
  .lab-layout {
    margin-top: 12px;
    gap: 12px;
  }
}
</style>
