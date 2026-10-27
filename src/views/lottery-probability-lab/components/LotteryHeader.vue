<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type {
  AutomaticOfficialSyncStatus,
  BackupExportResult,
  BackupImportResult,
  DrawSummary,
  ImportDrawCsvResult,
  OfficialHistorySyncProgress,
  PredictionOperationResult,
  ReviewStatistics,
} from "../types";

const props = defineProps<{
  summary: DrawSummary;
  officialSync: OfficialHistorySyncProgress;
  automaticSync: AutomaticOfficialSyncStatus;
  statistics: ReviewStatistics;
  onImportCsv: (csvText: string) => Promise<ImportDrawCsvResult>;
  onGenerate: () => Promise<PredictionOperationResult>;
  onExportBackup: () => Promise<BackupExportResult>;
  onImportBackup: (jsonText: string) => Promise<BackupImportResult>;
}>();

const showImportDialog = ref(false);
const isGenerating = ref(false);
const isBackingUp = ref(false);
const backupInput = ref<HTMLInputElement>();
const importText = ref("");
const importRejected = ref<{ line: number; reason: string }[]>([]);

const formattedLatestDate = computed(
  () => props.summary.latestDraw?.date ?? "等待自动同步",
);
const automaticSyncLabel = computed(() => {
  if (props.officialSync.status === "syncing") {
    return `同步 ${props.officialSync.currentPage}/${props.officialSync.pageTotal ?? "…"} · 已收集 ${props.officialSync.collectedCount} 条`;
  }
  const sync = props.automaticSync;
  if (sync.phase === "bootstrapping") return "首次同步官方全部历史中";
  if (sync.phase === "syncing" || sync.phase === "retrying") {
    return `同步 ${sync.nextSyncAt ? "开奖结果" : "官方数据"} · 第 ${sync.attempt + 1} 次尝试`;
  }
  if (sync.nextSyncAt)
    return `下次自动同步：${formatShanghaiTime(sync.nextSyncAt)}`;
  return sync.message ?? "自动同步尚未排定";
});

function formatShanghaiTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

const submitImport = async () => {
  const result = await props.onImportCsv(importText.value);
  if (!result.ok) {
    ElMessage.error(result.error.message);
    return;
  }
  importRejected.value = [...result.rejected];
  ElMessage.success(result.message);
  if (!result.rejected.length) {
    showImportDialog.value = false;
    importText.value = "";
  }
};

const generate = async () => {
  isGenerating.value = true;
  const result = await props.onGenerate();
  isGenerating.value = false;
  if (!result.ok) {
    ElMessage.warning(result.error.message);
    return;
  }
  if ("conclusion" in result.value) {
    ElMessage.success("随机性审计已更新。");
    return;
  }
  ElMessage.success(
    result.value.fallbackReason ?? "已生成并保存 3 注不可变预测快照。",
  );
};

const exportBackup = async () => {
  isBackingUp.value = true;
  const result = await props.onExportBackup();
  isBackingUp.value = false;
  if (!result.ok) {
    ElMessage.error(result.error.message);
    return;
  }

  const datePart = result.value.exportedAt.slice(0, 10).replace(/-/g, "");
  const blob = new Blob([JSON.stringify(result.value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `双色球概率实验室备份-${datePart}.json`;
  link.click();
  URL.revokeObjectURL(url);
  ElMessage.success("已导出完整 JSON 备份，请妥善保存该文件。");
};

const chooseBackupFile = () => backupInput.value?.click();

const importBackupFile = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  try {
    const jsonText = await file.text();
    await ElMessageBox.confirm(
      "恢复会完整替换当前浏览器内的开奖记录、预测快照和复盘结果。请先导出当前备份再继续。",
      "确认恢复备份？",
      {
        confirmButtonText: "确认替换",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
    isBackingUp.value = true;
    const result = await props.onImportBackup(jsonText);
    isBackingUp.value = false;
    if (!result.ok) {
      ElMessage.error(result.error.message);
      return;
    }
    ElMessage.success(
      `已恢复 ${result.value.draws.length} 期开奖记录与 ${result.value.snapshots.length} 个预测快照。`,
    );
  } catch (error) {
    isBackingUp.value = false;
    if (error !== "cancel" && error !== "close")
      ElMessage.error("无法读取或恢复该备份文件。");
  }
};
</script>

<template>
  <header class="lab-header">
    <div class="brand-block">
      <div class="brand-mark" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <div>
        <p class="eyebrow">LOCAL · PROBABILITY LAB</p>
        <h1>双色球概率实验室</h1>
        <p class="subcopy">
          官方开奖在页面开启期间于北京时间周二、四、日 21:30
          自动同步；下次打开会补拉最新结果。
        </p>
      </div>
    </div>

    <div class="header-actions">
      <div class="mini-stat">
        <span>已录入期数</span><strong>{{ summary.totalDraws }}</strong>
      </div>
      <div class="mini-stat latest-stat">
        <span>最新数据</span
        ><strong>{{ summary.latestDraw?.issue ?? "—" }}</strong
        ><small>{{ formattedLatestDate }}</small>
      </div>
      <div class="auto-sync-status" :class="`phase-${automaticSync.phase}`">
        <span>官方自动同步</span>
        <strong>{{ automaticSyncLabel }}</strong>
        <small>{{
          automaticSync.message ?? "页面关闭期间无法运行定时器。"
        }}</small>
      </div>
      <el-button plain :loading="isBackingUp" @click="exportBackup"
        >导出备份</el-button
      >
      <el-button plain :loading="isBackingUp" @click="chooseBackupFile"
        >恢复备份</el-button
      >
      <el-button plain @click="showImportDialog = true">导入 CSV</el-button>
      <el-button type="primary" :loading="isGenerating" @click="generate"
        >开始计算</el-button
      >
      <input
        ref="backupInput"
        class="hidden-file-input"
        type="file"
        accept="application/json,.json"
        @change="importBackupFile"
      />
    </div>
  </header>

  <el-dialog
    v-model="showImportDialog"
    title="导入历史开奖 CSV"
    width="min(760px, calc(100vw - 28px))"
    destroy-on-close
  >
    <p class="dialog-tip">
      官方自动同步通常无需手工新增开奖。CSV
      仅用于网络或官方接口不可用时的兜底导入。
    </p>
    <p class="dialog-tip">
      表头固定为：<code>issue,date,red1,red2,red3,red4,red5,red6,blue</code>
    </p>
    <el-input
      v-model="importText"
      type="textarea"
      :rows="10"
      placeholder="粘贴 CSV 内容；空行会被忽略。"
    />
    <el-alert
      v-if="importRejected.length"
      class="import-alert"
      type="warning"
      :closable="false"
      show-icon
    >
      <template #title>以下 {{ importRejected.length }} 行未导入</template>
      <p v-for="item in importRejected" :key="item.line">
        第 {{ item.line }} 行：{{ item.reason }}
      </p>
    </el-alert>
    <template #footer
      ><el-button @click="showImportDialog = false">关闭</el-button
      ><el-button type="primary" @click="submitImport"
        >校验并导入</el-button
      ></template
    >
  </el-dialog>
</template>

<style scoped lang="less">
.lab-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 106px;
  padding: 20px 28px;
  color: #fff;
  background: linear-gradient(118deg, #103b95 0%, #215bc9 58%, #3877dd 100%);
  border-radius: var(--app-radius-large);
  box-shadow: 0 16px 35px rgb(26 71 157 / 20%);
}
.brand-block {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}
.brand-mark {
  position: relative;
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  overflow: hidden;
  background: rgb(255 255 255 / 12%);
  border: 1px solid rgb(255 255 255 / 28%);
  border-radius: 14px;
}
.brand-mark span {
  position: absolute;
  width: 16px;
  height: 16px;
  background: #ff5b6c;
  border-radius: 50%;
  box-shadow: inset 0 -2px 0 rgb(127 0 0 / 20%);
}
.brand-mark span:nth-child(1) {
  top: 8px;
  left: 9px;
}
.brand-mark span:nth-child(2) {
  right: 8px;
  bottom: 9px;
}
.brand-mark span:nth-child(3) {
  bottom: 7px;
  left: 10px;
  background: #77adff;
}
.eyebrow {
  margin: 0 0 3px;
  color: rgb(255 255 255 / 70%);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.2px;
}
.brand-block h1 {
  margin: 0;
  font-size: 24px;
  letter-spacing: 0.2px;
}
.subcopy {
  max-width: 470px;
  margin: 6px 0 0;
  color: rgb(255 255 255 / 76%);
  font-size: 12px;
  line-height: 1.45;
}
.header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
.header-actions :deep(.el-button) {
  height: 36px;
  margin: 0;
}
.header-actions :deep(.el-button--plain) {
  color: #fff;
  background: rgb(255 255 255 / 10%);
  border-color: rgb(255 255 255 / 40%);
}
.header-actions :deep(.el-button--primary) {
  color: var(--app-brand-deep);
  background: #fff;
  border-color: #fff;
}
.mini-stat {
  min-width: 75px;
  padding: 1px 8px;
  text-align: right;
}
.mini-stat span,
.mini-stat small {
  display: block;
  color: rgb(255 255 255 / 67%);
  font-size: 10px;
}
.mini-stat strong {
  display: block;
  margin-top: 3px;
  font-size: 19px;
  line-height: 1.05;
}
.mini-stat small {
  margin-top: 3px;
}
.auto-sync-status {
  display: grid;
  min-width: 185px;
  max-width: 245px;
  gap: 3px;
  padding: 7px 10px;
  background: rgb(0 20 70 / 17%);
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 8px;
}
.auto-sync-status span,
.auto-sync-status small {
  color: rgb(255 255 255 / 67%);
  font-size: 9px;
}
.auto-sync-status strong {
  overflow: hidden;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.phase-error {
  background: rgb(137 38 48 / 26%);
}
.hidden-file-input {
  display: none;
}
.full-width {
  width: 100%;
}
.dialog-tip {
  margin-top: 0;
  color: var(--app-muted-color);
  font-size: 13px;
}
.dialog-tip + .dialog-tip {
  margin-top: 5px;
}
.dialog-tip code {
  padding: 2px 5px;
  color: var(--app-brand-deep);
  background: var(--app-brand-soft);
  border-radius: 4px;
}
.import-alert {
  margin-top: 14px;
}
.import-alert p {
  margin: 4px 0 0;
  font-size: 12px;
}
@media (max-width: 1120px) {
  .lab-header {
    flex-direction: column;
    align-items: flex-start;
  }
  .header-actions {
    justify-content: flex-start;
  }
  .mini-stat {
    padding-left: 0;
    text-align: left;
  }
}
@media (max-width: 600px) {
  .lab-header {
    padding: 18px;
  }
  .brand-mark {
    display: none;
  }
  .brand-block h1 {
    font-size: 21px;
  }
  .header-actions {
    width: 100%;
  }
  .latest-stat {
    display: none;
  }
  .auto-sync-status {
    width: 100%;
    max-width: none;
  }
}
</style>
