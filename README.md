# AI Panel Studio

输入一个议题，AI 自动组建「1 位主持人 + N 位专家」，确认后进入演播厅，实时观看一场顺序自主、
可重放、有共识/分歧提炼和自然语言总结的圆桌讨论。

- 前端：Vue 3.5 + Vite + TypeScript + Pinia（`web/`）
- 后端：Node 22 + Fastify + TypeScript + better-sqlite3（`server/`）
- 共享契约：zod schema 推导类型（`shared/`）
- 模型：DeepSeek（OpenAI 兼容接口），实际服务模型 **`deepseek-flash`**
- 数据：SQLite 单文件（默认 `server/data/app.db`），9 张表，迁移 + 可重复 seed

## 快速开始

要求：Node ≥ 22、pnpm 11。

```powershell
pnpm install

# Key 只放进程环境变量，不落盘、不进前端
$env:DEEPSEEK_API_KEY = "sk-..."      # bash: export DEEPSEEK_API_KEY=sk-...

pnpm -C server db:migrate
pnpm -C server db:seed               # 5 条样例讨论，可重复执行

# 两个终端
pnpm -C server dev                   # http://127.0.0.1:8787
pnpm -C web dev                      # http://127.0.0.1:5173
```

打开 `http://127.0.0.1:5173`，点「发起新讨论」。真实一场约 1–5 分钟（20 条专家发言 + 账本 + 提炼 + 追问）。

健康检查：`curl http://127.0.0.1:8787/health` → `{"status":"ok","db":"ok","llm":"configured","now":"..."}`
（永远 200；`llm=missing` 是配置状态，不是故障）。

演示 / 截图必须走「发起新讨论」：种子讨论的 `session_id` 为 `NULL`，按 AC-3.8 对任何浏览器只读。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 无 | 唯一凭据。只在 `server/src/llm/config.ts` 读取；缺失时业务接口返回 500 `LLM_NOT_CONFIGURED`，`/health` 仍 200 |
| `DEEPSEEK_MODEL` | `deepseek-flash` | 请求模型名。落库以响应返回的 `model` 为准（`llm_calls.model`） |
| `PORT` | `8787` | API 端口 |
| `AI_PANEL_DB` | `server/data/app.db` | SQLite 路径。E2E 指向 `.e2e/app.db`，与演示库隔离 |
| `FAKE_LLM` | 未设置 | 仅 `=1` 时在入口注入 fake transport（E2E 用）。生产路径返回 `undefined`，500 预检保持有效 |

E2E 额外使用 `FAKE_LLM_DELAY_MS`（默认 20ms）模拟模型耗时。

## 技术选型理由

- **Fastify + better-sqlite3**：单进程同步事务，`BEGIN IMMEDIATE + RETURNING` 能给 `events.seq` 稳定取号；
  没有连接池和 N+1，MVP 阶段比 ORM 更快也更少出错。
- **zod 单一契约（shared/）**：API JSON、SSE payload、zod key、DB 列名全部 snake_case，零映射层；
  类型从 schema 推导，前端与后端不可能各写一套。
- **Pinia 五份独立 state**：状态 / 专家状态 / transcript / 共识 / 分歧物理分开，是作业硬要求，也避免
  「一个大对象」导致的一次更新整块重渲染。
- **SSE 用 `fetch + ReadableStream`，不用原生 `EventSource`**：需要带 `Last-Event-ID`、404 不重连、
  区分正常结束与断线，这三件事 `EventSource` 都做不到。
- **无 ORM、无 Redux、无 GraphQL**：非目标；少一层抽象就少一处与契约不一致的地方。
- **fake 只替换 transport**：`llm_calls` 的重试/成功/降级仍走生产代码路径，E2E 不会绕开审计。

## API（10 个）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 永远 200，body 含 `status/db/llm/now` |
| GET | `/api/discussions?active=1` | 列表（摘要字段 + `guest_count` / `expert_color_ids` / `summary_text`） |
| POST | `/api/discussions` | 新建（draft），写 `state.draft` |
| GET | `/api/discussions/:id` | 详情 + 阵容（不含 turns / 共识 / 状态） |
| POST | `/api/discussions/:id/guests/generate` | 生成 1 主持 + N 专家（`locked=0`） |
| POST | `/api/discussions/:id/guests/confirm` | 锁定阵容（`locked=1`）+ 建 agent_status + `state.ready` |
| POST | `/api/discussions/:id/start` | ready → running，异步启动主循环 |
| POST | `/api/discussions/:id/cancel` | 任意未终态 → cancelled（`error_code` 恒 NULL） |
| POST | `/api/discussions/:id/retry-summary` | 仅 `failed + ALL_SPEAKERS_FAILED` 可重试总结 |
| GET | `/api/discussions/:id/events` | SSE：6 个持久事件族 + `: ping` / `caught_up`，支持 `Last-Event-ID` 补发 |

契约原文：`specs/001-panel/contracts/openapi.yaml`、`specs/001-panel/contracts/events.md`。

## 已完成

- S0–S10 全部交付；S11 完成真调取证、删 QA 开关、文档与分层提交。
- `pnpm check`：17 个测试文件 / 110 条测试全绿（tsc ×2 + vitest）。
- `pnpm e2e`：一条完整链路 + 一条失败重试链路，两遍均 `2 passed`，E2E 走独立库。
- 真实运行（discussion 81）：270s、27 条 turn、`expert_turn_count=20`、总结 195 字；
  `llm_calls` 68 行全部 `model='deepseek-flash'`。
- 9 张验收截图（1440/1280/390 × 三页）来自真实数据，见 `docs/WORK_REPORT.md`。

## 后续改进

- `support_guest_ids` 已改为模型结构化输出 + 精确姓名校验；剩余风险是模型漏填时降级为空支持（不猜），下次真调抽检一次。
- 并发 `retry-summary` 已由单进程闸挡住（第二个请求 409、零模型调用）；多进程部署需换成 DB 级锁。
- `turn.delta` 通道已保留但未启用流式；若要「打字机」效果，需补 LLM 流式解析与取消语义。
- 慢客户端 SSE 背压（`write()` 返回 false）暂未处理。
- `pnpm check` 的一次性失败已定位为 tinypool 的 IPC 竞态（`Channel closed`），现单 fork 复用进程，20 连跑无复现；E2E 首跳 `NETWORK_ERROR` 未复现，已加 globalSetup 预热 + 代理路径就绪门。

## 常用命令

```powershell
pnpm check          # shared build + server tsc + vitest（17 files / 110 tests）
pnpm e2e            # Playwright（seed + server + web，一遍 2 passed；验收要求连跑两遍）
pnpm db:report      # 打印 9 张表的行数
pnpm -C server test -- ledger   # 按文件名过滤
```

## 目录

```
server/src/   db/ 迁移与 seed；llm/ 模型唯一出口；modules/{discussion,guest,host,turn,summary,sse}
shared/       zod schema 与推导类型（唯一契约）
web/src/      views/ 三页；components/{common,theater,guest,home,layout}；stores/；api/
specs/        spec.md / data-model.md / contracts/
docs/         PRD、WORK_REPORT、PROMPT_LOG、COVERAGE、TEST、DESIGN、OPEN_ISSUES
e2e/          Playwright 用例（产物不提交）
```
