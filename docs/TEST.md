# TEST.md — 测试说明

> 覆盖矩阵以 `docs/COVERAGE.md` 为准；本文件只写「怎么跑、跑什么、为什么这么跑」。
> 最后一次更新：S11（真调取证、删 QA 开关、文档）。

## 1. 命令

```bash
pnpm check                 # shared build → server tsc --noEmit → vitest（16 files / 104 tests）
pnpm -C server test        # 只跑单测 / 集成
pnpm -C server test -- summary   # 按文件名过滤
pnpm e2e                   # Playwright：seed + 起 server + 起 web，跑完自动收摊
```

`pnpm e2e` **必须连跑两遍都绿**才算通过（第一遍留下数据、第二遍在新一轮 seed 上重跑）。

隔离与两遍验收：E2E 的 seed 与 server 共用 `AI_PANEL_DB=.e2e/app.db`（已 gitignore），演示库
`server/data/app.db` 一行不写；两遍之间没有任何共享状态，第二遍是新一轮 seed 上的独立重跑。
真实模型证据只取真调写出的演示库，`.e2e/app.db` 的 `llm_calls`（fake 失败行会回落默认模型名）不能当证据。

## 2. 两层分工

| 层 | 位置 | 负责 |
|---|---|---|
| 单元 / 集成 | `server/test/**`（纯函数 + Fastify inject + 临时 SQLite） | 契约字段、状态机、账本/决策、SSE 帧、兜底与超时、审计行 |
| E2E | `e2e/**` | 真实浏览器里跑通一场讨论，验证五条数据流在三页上的接线与视觉不裁切 |

E2E 只回答「整条链路通不通」，不重复单测已经锁死的分支。

## 3. E2E 跑什么

**`e2e/full-flow.spec.ts`（一条链路，不是四个小用例，全程同一个 browser context）**

1. 首页：`进行中` / `已结束` 分组 + 至少一张样例讨论卡
2. 发起新讨论 → 议题 + 专家数 4 → 生成嘉宾
3. 确认页：5 张卡片，每张都有姓名 / 职业 / 立场 / `--expert` 色块
4. 确认 → 演播厅，transcript ≥ 6 条且每条都有发言人名
5. 专家徽标出现过「发言中」（MutationObserver 记录，不靠轮询抓瞬时帧）
6. 总结面板 `.summary-panel__text` > 50 字；页面上不出现原始 JSON（连 `&quot;` 转义形态一起查）
7. 390×844：`.summary-panel` 的 body `scrollHeight > clientHeight` 且能滚到底（滚，不是裁）
8. `GET /api/discussions/:id` 的 `summary_text` 与 UI 正文逐字相等（INV-9）

同一个 context 是硬要求：`sessionId` 存在 localStorage，AC-3.8 靠它判定归属。换 context 后确认页和演播厅的写入口会全部消失，失败表现是「按钮找不到」，不是权限报错。

**`e2e/retry-summary.spec.ts`**

议题带 `#fail-turn` → `failed` + `ALL_SPEAKERS_FAILED` → 点「重新生成总结」→ `finished`，
`summary_text` 与 `turns` 里那行 summary 逐字相等，`run.finished.reason='retry_summary'`。
`reason` 与 turn 正文只有 events 重放里有（详情接口不含 turns），所以取证走 `GET /events` + `Last-Event-ID: 0`。

## 4. E2E 的失败场景 = 全部专家失败 + 开场成功

fake（`server/src/llm/fake.ts`）只打挂**专家**发言，主持人开场保留。这不是放水：

- `runner` 的判定是 `expertTurnCount === 0 && failedExperts.size === experts.length`；
- 开场是 `speech_type='opening'`，不属于专家发言，保留后仍是「0 条专家发言 + 全部专家失败」；
- `retry.ts` 里 `reason = emptyTranscript ? 'empty_transcript' : 'retry_summary'`，
  要测 `retry_summary` 就必须 transcript 非空；
- `empty_transcript` 是另一条分支（连开场都没有），由 `server/test/summary/fallbacks.test.ts` 覆盖，E2E 不该伪造它。

## 5. 环境与隔离

- **独立 E2E 库**：`AI_PANEL_DB` 指向 `.e2e/app.db`（已 gitignore），seed 与 server 共用同一个 env。
  演示库 `server/data/app.db` 不因跑测试多出一行；两遍都可重复，也不用处理 FK 删除顺序。
- `reuseExistingServer: false`：端口 8787 / 5173 **必须空闲**。故意不复用陈旧服务，否则你测的是上次那个进程。
- `FAKE_LLM` 只在 `server/src/llm/index.ts` 读取（`fake.ts` 只读 `FAKE_LLM_DELAY_MS`）。
  生产分支返回 `undefined`，路由自己的 `deps.llm === undefined && !isLlmConfigured()` 预检保持有效 ——
  `server/test/llm/index.test.ts` 锁的就是这条，防止有人在入口「顺手」造真 client，把 500 预检永久吃掉。
- 假的是 transport，不是 client：`llm_calls` 的 `is_retry` / `success` / 重试与降级都走生产代码路径。

## 6. 已知坑

- **Vite 默认绑 `::1`**：Windows 上 `localhost` 先解析到 IPv6，探活打 `127.0.0.1` 会一直超时到 120s。
  所以 `webServer.command` 显式 `--host 127.0.0.1`。
- **不为 30s 总结超时拖慢 E2E**：超时分支由单测（20ms 注入）覆盖，E2E 不跑。
- **模型证据只取真调库**：fake 模式下失败调用（transport 抛错、拿不到响应 model）会以默认
  `deepseek-flash` 落审计行，`.e2e/app.db` 里的 `llm_calls` 不能当模型证据用。真实证据取自真调跑出来的库。
- **截图是产物不是提交物**：`e2e/screenshots/` 与 `test-results/` 都在 `.gitignore` 里；交付时是否单独收录由 S11 决定。
