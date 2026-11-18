# 工作说明 — AI Panel Studio

> 交付物原文要求「工作说明 1–1.5 页 + 2–3 个真实问题」。本文所有数字都能在
> `docs/SESSION_MAP.md`、`docs/PROMPT_LOG.md`、`docs/COVERAGE.md` 或下表的证据里找到出处；
> 模型证据只取自 S11 真跑出来的 `server/data/app.db`，不引用 `.e2e/app.db`。

## 1. 问题

作业要求 72 小时内交付一个「AI 圆桌讨论」MVP：输入议题 → 生成主持人 + 专家阵容 → 用户确认 →
实时观看一场讨论 → 结束后拿到自然语言总结。功能清单本身不难，难的是三件事同时成立：
**专家不能机械轮流**（发言顺序由模型自主决定，但必须可审计、可降级）、
**五条数据流互不污染**（状态 / 事件 / transcript / 共识 / 分歧各自独立）、
**整场讨论可重放**（断线能补发，页面里不出现任何原始 JSON）。

## 2. 拆解（S0–S10）

| Session | 产物 | 关键约束 |
|---|---|---|
| S0 契约冻结 | `spec.md`（44 条 EARS 验收标准）+ `data-model.md`（9 张表） | 先冻结「什么算做到」，再写代码 |
| S1 接口与事件协议 | `openapi.yaml`（10 个端点）+ `events.md`（6 个持久事件族 + 2 个控制帧） | 每个事件必须挂 AC 编号，挂不上就是过度设计 |
| S2 骨架 / 迁移 / seed | 可运行的 Fastify 服务 + 9 张表 + 5 条样例 | seed 必须可重复执行，且不写 `running` 死场 |
| S3 嘉宾生成与锁定 | `guests/generate` + zod 二次校验 + 重试 + 两段式锁定 | 只有校验通过才落库；`generate` 只写 `locked=0` |
| S4 主持人账本 | `host/ledger.ts`（progress ledger 模式） | `module='ledger'` 由调用方显式传；stall 计数入参出参 |
| S5 调度决策纯函数 | `host/decide.ts` | 不读时间 / 随机数 / DB / 网络，同一输入两次输出一致 |
| S6 SSE 事件总线 | `sse/bus.ts` + `guests/confirm` | 先落库后推送；断线只补 `seq > Last-Event-ID` |
| S6.5 生命周期 + 主循环 | 5 个讨论端点 + `turn/runner.ts` + 增量提炼 + 主持人追问 | 每 2 条专家发言提炼一次，每 4 条插一次追问 |
| S7 / S7.5 三页 + 设计系统 | 首页 / 确认页 / 演播厅；STAGE v2 token | 页面永不整页滚动，专家色只有一个映射点 |
| S8 状态层接线 | `stores/discussion.ts`（五份独立 state）+ `api/events.ts` | 不用原生 `EventSource`；按 seq 去重 |
| S9 收尾与兜底 | 总结硬校验 150–250 字 + 共识归并 + `retry-summary` | INV-9：`summary_text` 与 summary turn 逐字相同 |
| S10 E2E 闭环 | `e2e/**` + fake transport + 隔离库 | 一条链路走完；两遍可重复 |

**为什么这样拆**：每个 Session 只产出一个「命令能跑绿」的产物，且下一个 Session 的输入必须是上一个
Session 已经提交的文件。中途补了一个 S6.5 —— 审查时发现「讨论 CRUD + 主循环」没有任何 Session 认领，
这是拆解本身的漏洞，不是实现问题。

**工具与协作**：开发主体在 **OpenCode** 的会话里完成 —— 每个 Session 一个独立会话，会话之间不共享记忆，
`AGENTS.md` 是唯一的跨会话契约；执行 session 只交代码与验收输出，审查 session 在同一工具里独立复跑、
复现缺陷、修契约与文档。模型统一走 DeepSeek 的 OpenAI 兼容接口，`llm_calls.model` 存的是响应返回的
真实模型名（本轮为 `deepseek-flash`，Pro 档当前由 flash 承接），文档里没有写无法自证的型号。

## 3. 三个真实卡点（全部摘自 `PROMPT_LOG`）

**① 审计字段写死，33 条测试全绿但审计表全错（S3）**
`llm_calls.module` 在 client 里被写成字面量 `'guest'`。S3 只有一种调用，所以 33 条测试全过；
但 S4 的账本、S6.5 的发言/总结一接进来，所有调用都会被记成 guest，「这场讨论调了几次模型」整体失真。
修法：`module` 改成 `LlmModule` 由调用方显式传，并加回归测试断言 `llm_calls.module === 'ledger'`。

**② `matchMedia` 在 Playwright 视口仿真下不触发（S7）**
第一版演播厅用 `matchMedia('(max-width:900px)')` 驱动单栏，代码读起来完全正确；实测监听器触发 0 次，
而 `matches` 已经是 true。结果 390px 下阵容 / 现场 / 简报三块同时渲染、叠在同一个 grid 格里，
1440 截图完全看不出来。修法：断点全部交给 CSS，验收加一条「390 下同时可见面板数 === 1」。

**③ 只有真跑才会露出来的两个事实（S6.5）**
单测里每轮 100% 成功、0ms；真跑一场时 `turn.started` 比 `turn.done` 多 1 条（一次空发言失败后重试，
`turn_no` 被复用），且 ledger 的 JSON 有 4/23 解析失败（重试后成功）。前者写成「客户端按
`(guest_id, turn_no)` 幂等」的契约，后者保留为已知质量项。S11 这次真调再次复现同类现象：
27 条 turn 对应 29 条 `turn.started`，`llm_calls` 里有 9 行 `success=0`（见下表）。

## 4. S11 真实运行（唯一模型证据）

真 Key、无 `FAKE_LLM`、从 UI 新建 → 确认 → 等到结束：

| 观测项 | 数值 | 出处 |
|---|---|---|
| discussion_id | 81 | `GET /api/discussions/81` |
| 时长 | 270s（04:46:33 → 04:51:02 UTC） | `discussions.started_at/finished_at` |
| 结束原因 | `max_turns`，`expert_turn_count=20` | `events` 里 `run.finished` 的 payload |
| turns | 27 条（1 开场 + 20 专家 + 5 追问 + 1 总结） | `SELECT speech_type, COUNT(*) FROM turns WHERE discussion_id=81` |
| 总结 | 195 字，INV-9 成立 | `LENGTH(summary_text)` + summary turn |
| 模型 | 81 号场次 68 行 `llm_calls` **全部** `model='deepseek-flash'` | `SELECT ... WHERE discussion_id=81 GROUP BY 1,2,3,4` |
| 重试 | 4 次 `is_retry=1` 成功；1 次重试仍失败；81 号场次共 9 行 `success=0` | 同上 |
| 全库 | 69 行（= 81 的 68 + 截图轮 82 号 draft 的 1 次 guest 生成），仍全部 deepseek-flash | 全库 `GROUP BY 1,2,3,4` |
| 截图 | 9 张（1440/1280/390 × 三页），来自上述真实数据 | `D:\temp\s11-shots\` |
| 测试 | `pnpm check` 17 文件 / 110 测试；`pnpm e2e` 两遍各 `2 passed` | 命令输出 |

一个诚实的偏差：SESSION_MAP 估计真调一场 1–3 分钟，实际 4.5 分钟（20 条专家发言 + 账本 + 提炼 + 追问）。
这也是 E2E 必须走 fake、且真调用例超时不能沿用 30s 的原因。

## 5. 已知限制（不掩盖）

- `support_guest_ids` 已改为模型结构化 supporters + 精确姓名校验（旧的姓名子串匹配删除）。剩余风险：真实模型漏填 supporters 时降级为空，不会误算；本轮未再跑真调复验这一处。
- 并发 `retry-summary` 已加单进程闸：第二个请求 409 且不调用模型；多进程部署需换 DB 级锁。
- `pnpm check` 的一次性失败已定位为 tinypool `Channel closed`（worker 回收时 IPC 已关）；
  改单 fork 后 20 连跑无复现。E2E 首跳 `NETWORK_ERROR` 仍未复现，已加 globalSetup 预热 + 代理路径就绪门；两者都不加重试。

## 6. 提交顺序

约定前缀是 `docs: → schema: → test: → feat: → ui: → e2e:`，但本轮实际顺序是 **ui → docs**：
先删掉 QA 用的 `?state=` 开关并重拍截图，再用最终代码跑出的数字写 PRD / README / 本文。
反过来先写文档，数字就只能靠估 —— S11 开工第一步先取证，也是同一个道理。
