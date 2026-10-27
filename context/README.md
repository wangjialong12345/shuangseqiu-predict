# 双色球概率实验室上下文

## 项目说明

这是一个仅在浏览器本地运行的双色球历史数据审计、概率建模、三注候选生成与开奖回测页面；它不会把任何算法描述为提高公平开奖中奖概率的保证。

## 工程基线

| 项目 | 已确认事实 | 证据 |
|---|---|---|
| 前端框架与页面文件 | Vue 3 + TypeScript + Vite，Vue 单文件组件（SFC）中共置 template、script 和局部 style。项目将选择性借鉴给定 `vue3-element-plus-admin` 模板的组件与 Less 样式习惯，不迁入权限和后端业务模块。 | 开发者确认；`/Users/pwrd/Desktop/ihumanWork/vue3模版/vue3-element-plus-admin/src/main.ts` |
| Node 运行时 | Node.js `>=20`。 | `package.json` |
| 视图代码根目录 | `src/views` | 新建项目页面约定 |
| 请求客户端 | 页面私有 API 使用浏览器原生 `fetch`。本地开发通过 Vite 同源代理调用用户提供的中国福利彩票双色球历史开奖接口；生产部署需配置以 `/` 开头的同源反向代理基址 `VITE_CWL_API_BASE`。无项目后端。 | 开发者确认；[接口文档](views/lottery-probability-lab/api.md) |
| 状态方案 | 由页面视图模块和单元以 Vue Composition API 自行实现；核心历史数据使用浏览器 IndexedDB，`localStorage` 只保留轻量 UI 选择。 | 开发者确认 |
| 测试设施 | 当前空仓库没有已有测试框架；本轮不能为形式新增测试框架。 | 项目根目录检查 |
| 样式与组件 | Element Plus、Less 和模板同类的后台内容区 / 卡片 / 设计令牌风格。 | 开发者提供的模板 `src/styles/index.less`、`src/styles/var.css` |

## 常用命令

| 目的 | 命令 | 适用范围 |
|---|---|---|
| 类型检查 | `npm run check-ts` | 项目 TypeScript 与 Vue SFC |
| 格式检查 | `npm run format:check` | 项目受 Prettier 覆盖的文件 |
| 构建 | `npm run build` | 生产构建 |
| 本地运行 | `npm run dev` | Vite 本地开发服务器 |

## 页面代码约定

以下约定适用于本项目的新建页面。

### 目录与命名

| 对象 | 新建代码约定 |
|---|---|
| 视图目录 | `src/views/<view-name>/`，使用 kebab-case |
| 页面入口 | `index.vue` |
| 视图模块入口 | `module.ts` |
| 跨单元共享类型 | `types.ts`，仅需要时创建 |
| 页面内部 API 入口 | 仅调用 HTTP 接口时才创建；本页面不创建 |
| 单元目录与入口 | `units/<unit-name>/index.ts`，使用 kebab-case |
| 页面内部组件 | `components/` 下的 PascalCase Vue SFC |
| 测试 | 当前没有测试框架；不虚构测试文件或测试命令 |

### 依赖边界

```text
页面入口
  ├── 创建并消费视图模块 → 单元 → 页面私有 API / IndexedDB 持久化
  └── 只读状态与属性 → 子组件 → 事件 / 回调 → 页面入口
```

- 页面入口是唯一创建和持有视图模块实例的框架文件。
- 子组件只接收渲染所需的只读状态、普通属性和事件回调；不接收完整视图模块或单元实例，不直接调用 IndexedDB 或 `localStorage`。
- 视图模块只组装单元和协调跨单元行为；单元不直接修改彼此状态。
- 页面私有算法、数据校验和持久化代码保留在最近的页面职责拥有者目录，未经确认不建立跨页面业务抽象。
- Vue SFC 默认将紧密相关的模板、框架绑定和局部样式放在同一文件；业务逻辑优先进入视图模块或单元。

## 页面导航

| 页面 | 路由 | 上下文 |
|---|---|---|
| 双色球概率实验室 | `/` | [需求](views/lottery-probability-lab/requirements.md) · [技术设计](views/lottery-probability-lab/technical-design.md) · [接口](views/lottery-probability-lab/api.md) · [测试规格](views/lottery-probability-lab/testing.md) · [单元](views/lottery-probability-lab/units/) |
