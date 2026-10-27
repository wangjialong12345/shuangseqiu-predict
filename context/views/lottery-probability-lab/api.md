# 双色球概率实验室 - 外部开奖接口

本页面没有项目后端 HTTP 接口。用户主动点击“同步官方往期”时，页面通过浏览器原生 `fetch` 调用以下中国福利彩票历史开奖查询接口。

## 公共约定

| 项目 | 外部接口约定 |
|---|---|
| 官方上游 | `https://www.cwl.gov.cn` |
| 本地开发请求基址 | `/official-cwl-api`，由 `vite.config.ts` 代理到官方上游。 |
| 生产请求基址 | `VITE_CWL_API_BASE`；必须配置为部署环境中以 `/` 开头的同源反向代理基址。 |
| 鉴权 | 无 |
| 请求方式 | 浏览器同源 GET。页面不直接跨域请求官方上游，以避免浏览器 CORS 限制；开发环境用 Vite 代理，生产环境由部署反向代理提供以 `/` 开头的同源路径。 |
| 数据写入 | 仅在全部分页响应成功、完成前端规范化后写入 IndexedDB；不将响应提交给项目后端。 |

## GET /cwl_admin/front/cwlkj/search/kjxx/findDrawNotice

查询中国福利彩票双色球历史开奖分页数据。

### 查询参数（Query Parameters）

| 参数 | 类型 | 必填 | 固定值 / 来源 | 含义 |
|---|---|---|---|---|
| `name` | `string` | 是 | `ssq` | 双色球标识。 |
| `issueCount` | `string` | 是 | 空字符串 | 保持官方查询接口默认筛选。 |
| `issueStart` | `string` | 是 | 空字符串 | 不按期号范围筛选。 |
| `issueEnd` | `string` | 是 | 空字符串 | 不按期号范围筛选。 |
| `dayStart` | `string` | 是 | 空字符串 | 不按日期起始筛选。 |
| `dayEnd` | `string` | 是 | 空字符串 | 不按日期结束筛选。 |
| `pageNo` | `number` | 是 | 从 `1` 递增至响应 `pageNum` | 当前分页。 |
| `pageSize` | `number` | 是 | `30` | 每页记录数。 |
| `week` | `string` | 是 | 空字符串 | 保持官方查询接口默认筛选。 |
| `systemType` | `string` | 是 | `PC` | 官方接口客户端类型。 |

### 成功响应

```json
{
  "state": 0,
  "message": "查询成功",
  "pageNo": 1,
  "pageSize": 30,
  "pageNum": 70,
  "total": 2080,
  "result": [
    {
      "code": "2026122",
      "date": "2026-10-25(日)",
      "red": "01,02,04,17,19,30",
      "blue": "09"
    }
  ]
}
```

| 字段 | 类型 | 可空 | 含义 |
|---|---|---|---|
| `state` | `number` | 否 | `0` 表示接口查询成功。 |
| `message` | `string` | 是 | 官方响应提示。 |
| `pageNo` | `number` | 否 | 当前分页。 |
| `pageNum` | `number` | 否 | 总页数；用于决定后续请求次数。 |
| `result` | `array` | 否 | 当前页开奖记录。 |
| `result[].code` | `string` | 否 | 开奖期号。 |
| `result[].date` | `string` | 否 | 开奖日期文本；前 10 位转换为本地日期。 |
| `result[].red` | `string` | 否 | 以逗号分隔的 6 个红球。 |
| `result[].blue` | `string` | 否 | 蓝球号码。 |

### 接口与数据错误

- HTTP 非成功、网络错误、未配置生产代理、JSON 解析失败、`state !== 0`、分页字段无效或结果不是数组，均视为本轮同步失败；不得写入本轮数据。
- 单条开奖结果无法转为合法双色球记录时跳过该条，并在最终同步结果中反馈跳过数量。
- 远程记录的其他字段不被页面使用。
