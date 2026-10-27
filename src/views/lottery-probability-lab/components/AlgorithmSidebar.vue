<script setup lang="ts">
import type { AlgorithmDefinition, AlgorithmId } from "../types";

defineProps<{
  algorithms: readonly AlgorithmDefinition[];
  activeAlgorithmId: AlgorithmId;
  onSelect: (algorithmId: AlgorithmId) => void;
}>();
</script>

<template>
  <aside class="algorithm-sidebar">
    <div class="sidebar-title">
      <p>ALGORITHM MENU</p>
      <h2>算法工作台</h2>
      <span>每项都是独立的统计假设或决策方法。</span>
    </div>
    <nav>
      <button
        v-for="algorithm in algorithms"
        :key="algorithm.id"
        type="button"
        :class="{ active: algorithm.id === activeAlgorithmId }"
        @click="onSelect(algorithm.id)"
      >
        <span class="menu-icon">{{
          algorithm.id === activeAlgorithmId ? "●" : "○"
        }}</span
        ><span class="menu-copy"
          ><strong>{{ algorithm.shortName }}</strong
          ><small>{{
            algorithm.kind === "audit"
              ? "只审计，不选号"
              : algorithm.kind === "baseline"
                ? "理论对照"
                : algorithm.kind === "portfolio"
                  ? "组合去重"
                  : "研究性模型"
          }}</small></span
        ><span class="chevron">›</span>
      </button>
    </nav>
    <div class="sidebar-footnote">
      <b>重要边界</b>
      <p>
        没有通过时间顺序回测的研究模型，会自动回退为均匀基准，不把历史拟合当作预测能力。
      </p>
    </div>
  </aside>
</template>

<style scoped lang="less">
.algorithm-sidebar {
  overflow: hidden;
  background: #fff;
  border: 1px solid var(--app-border-color);
  border-radius: var(--app-radius-large);
  box-shadow: var(--app-shadow-card);
}
.sidebar-title {
  padding: 20px 19px 16px;
  color: #fff;
  background: linear-gradient(145deg, #183d87, #245cc0);
}
.sidebar-title p {
  margin: 0 0 5px;
  color: rgb(255 255 255 / 66%);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.2px;
}
.sidebar-title h2 {
  margin: 0;
  font-size: 17px;
}
.sidebar-title span {
  display: block;
  margin-top: 7px;
  color: rgb(255 255 255 / 73%);
  font-size: 11px;
  line-height: 1.5;
}
.algorithm-sidebar nav {
  padding: 7px;
}
.algorithm-sidebar button {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 8px;
  padding: 11px 9px;
  color: #55637c;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 9px;
  cursor: pointer;
  transition:
    background var(--transition-time-02),
    color var(--transition-time-02);
}
.algorithm-sidebar button:hover {
  color: var(--app-brand-deep);
  background: #f5f8ff;
}
.algorithm-sidebar button.active {
  color: var(--app-brand-deep);
  background: var(--app-brand-soft);
}
.menu-icon {
  font-size: 11px;
}
.menu-copy {
  display: grid;
  flex: 1;
  gap: 3px;
}
.menu-copy strong {
  font-size: 12px;
}
.menu-copy small {
  color: #98a4b5;
  font-size: 9px;
}
.chevron {
  color: #a7b0bf;
  font-size: 19px;
  line-height: 1;
}
.sidebar-footnote {
  margin: 5px 13px 14px;
  padding: 12px;
  background: #fff9ed;
  border: 1px solid #f6e6c2;
  border-radius: 9px;
}
.sidebar-footnote b {
  color: #ad7b24;
  font-size: 10px;
}
.sidebar-footnote p {
  margin: 5px 0 0;
  color: #8f7a51;
  font-size: 10px;
  line-height: 1.55;
}
</style>
