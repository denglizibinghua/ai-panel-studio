# Session 地图 — AI Panel Studio

> 这份文件回答一个问题：**72 小时内，把"一整场讨论"切成 AI 能一口吃下的 11 块，每块怎么开场。**
> 每条提示词都可以直接复制粘贴。配套约束在 `AGENTS.md`。

---

## 铁律（先看这三条，否则后面全白搭）

1. **一个 Session 只产出一个可验收的产物。** 产物不是"我写好了"，是"这条命令跑绿了"。
2. **每个 Session 结束就把开场 Prompt + 卡点 + 修正抄进 `docs/PROMPT_LOG.md`。** 不要攒到最后编——面试会追问细节。
3. **新开 Session 只读文件，不读上一个 Session 的聊天记录。** 文件是记忆，对话是可抛弃的。

---

## 总表

| # | 名称 | 阶段 | 输入 | 产物 | 验收命令 | 预计 |
|---|---|---|---|---|---|---|
| S0 | 契约冻结 | SDD | REQUIREMENTS.md | `spec.md` + `data-model.md` | 人工检查清单 | 2–3h |
| S1 | 接口与事件协议 | SDD | spec + data-model | `contracts/openapi.yaml` + `events.md` | 人工检查清单 | 2h |
| S2 | 工程骨架 + 迁移 + seed | SDD | data-model + contracts | 可跑的 Node 服务 + 9 张表 + 5 条样例 | `pnpm -C server test` | 3h |
| S3 | 嘉宾生成与锁定 | SDD | `shared/schemas/guest.ts` | 生成接口 + 校验 + 幂等 | `pnpm -C server test -- guest` | 3h |
| S4 | 主持人账本 | TDD 前置 | events.md §7 + S3 校验风格 | ledger prompt + 解析 + 重试 + 停摆计数（`module='ledger'`） | `test -- ledger` + 审计归属断言 | 3h |
| S5 | 调度决策纯函数 | TDD | ledger schema | 先红后绿的 `decide.ts` | `pnpm -C server test -- decide` | 2h |
| S6 | SSE 事件总线 + confirm | TDD | contracts/events.md | 每讨论一条流 + 序号补发 + 清理 + `publishEphemeral` | 并发 curl + 补发测试 | 3h |
| S6.5 | 讨论生命周期 + 主循环 | TDD | contracts + `decide` + `publish` | 5 个 REST 端点 + `runner.ts` + 增量提炼 + **主持人追问** | `pnpm -C server test -- runner` | 5h |
| S7 | 三页 + 演播厅布局 | DDD | DESIGN.md + 本节线框 | HomeView / GuestConfirmView / TheaterView | 9 张截图 + 一致性 6 问 | 4h |
| S8 | 状态层接线 | DDD | S7 + events.md | fetch 流 → store → 五面板 | 真跑一场 | 3h |
| S9 | 收尾与兜底 | TDD | 全部 | 自然语言总结 + 共识定稿 + 失败兜底 | 边界用例 | 2h |
| S10 | E2E 闭环 | E2E | contracts | 一条完整 Playwright 用例 | `pnpm e2e` | 2h |
| S11 | 文档与提交 | — | 全部 | Prompt 记录 / 工作说明 / README / 邮件 | 打勾清单 | 2h |

**合计 ≈ 35h 的"AI 协作工时"，实际墙钟约 15–18h**，留足返工和睡觉。

---

## S0 · 契约冻结 ｜ SDD

- **输入**：`docs/REQUIREMENTS.md`
- **允许改**：`specs/001-panel/spec.md`、`specs/001-panel/data-model.md`
- **不要碰**：任何 `.ts` / `.vue` / `package.json`
- **验收**：每条验收标准都含 `SHALL`；每张表都有类型 / 可空 / 枚举；`NEEDS CLARIFICATION` 已清零

```
已读 AGENTS.md。本次执行 S0：契约冻结。
允许改的文件只有 specs/001-panel/spec.md 和 specs/001-panel/data-model.md，
其他任何文件一律不要碰，不要写代码，不要建目录，不要装依赖。

输入：docs/REQUIREMENTS.md

产出 1 —— spec.md：
按用户故事组织，P1 = 跑通一场完整讨论，P2 = 多讨论并行互不干扰，P3 = 首页列表与加入观察。
每个故事写「独立验收标准」，格式必须是 EARS，三选一：
  WHEN <事件> THEN THE SYSTEM SHALL <可观测响应>
  IF <前置条件> THEN THE SYSTEM SHALL <可观测响应>
  WHILE <状态> THE SYSTEM SHALL <可观测响应>
禁止出现"正常工作""符合预期""友好提示"这类不可测表述。
末尾加一节「硬约束」，逐条标注它在哪张表/哪个模块落地：
  五条数据流隔离 / 嘉宾生成后锁定 / 共识分歧增量更新 / 页面不整页滚动 / Key 只在后端。

产出 2 —— data-model.md：
9 张表的字段、类型、可空、默认值、枚举取值、索引，并用 mermaid erDiagram 画关系：
discussions / guests / turns / events / ledger /
consensus_points / divergence_points / agent_status / llm_calls
（llm_calls 记录每次模型调用的 module、耗时、token、是否重试、错误摘要 —— 用来控 10 元额度，
 也用来在报告里给出"这场讨论调用了几次模型"的真实数字。**不要存 prompt 原文。**）
其中 events.seq 必须是「每个 discussion_id 内单调递增」，并说明并发写入怎么保证。
样例数据不加独立表，直接作为普通 discussions/guests/turns 行写入，用 sample=1 标记。

产出 3 —— 歧义清单：
作业没写清的地方不要猜，写成 [NEEDS CLARIFICATION: <具体问题>]
单独列一节给我，我裁决完你再改。

做完只输出三样：两个文件路径、NEEDS CLARIFICATION 清单、你认为最可能有争议的 3 个设计决定。
不要开始写任何代码。
```

> **卡点预案**：它大概率会在 F5（共识）和 F4（状态小窗）上自作主张。盯住两件事——共识是不是 `provisional → final` 两态；状态表是不是独立于 transcript。

---

## S1 · 接口与事件协议 ｜ SDD

- **输入**：`spec.md`、`data-model.md`
- **允许改**：`specs/001-panel/contracts/openapi.yaml`、`specs/001-panel/contracts/events.md`
- **验收**：每个 endpoint 至少 1 个错误响应；每个事件有 `id/type/payload` 语义；补发语义写明"exclusive"

```
已读 AGENTS.md。本次执行 S1：接口契约与事件协议。
只允许新建这两个文件，其他一律不动：
  specs/001-panel/contracts/openapi.yaml
  specs/001-panel/contracts/events.md
输入：specs/001-panel/spec.md、specs/001-panel/data-model.md

openapi.yaml 必须覆盖这 9 个端点，每个都要有成功响应 + 至少 1 个错误响应，
错误码与 spec.md §4.2 逐字一致：
  GET  /api/discussions              （支持 ?active=1）
  POST /api/discussions
  GET  /api/discussions/{id}
  POST /api/discussions/{id}/guests/generate
  POST /api/discussions/{id}/guests/confirm
  POST /api/discussions/{id}/start
  POST /api/discussions/{id}/cancel
  GET  /api/discussions/{id}/events  （text/event-stream）
  GET  /health

events.md 定义 SSE 事件协议，**6 个持久事件族 + 2 个控制帧**，每个族列出所有 type +
payload 字段 + 触发时机 + 对应 AC 编号：
  state.*      讨论状态变化（含 cancelled 终态）
  run.*        run.started / run.finished / run.failed / run.cancelled（后两者不得共用 payload）
  agent.*      专家状态（idle/preparing/speaking）+ focus 文本
  turn.*       turn.started / turn.delta / turn.done（delta 不落库、不带 id）
  consensus.*  共识项新增或更新
  divergence.* 分歧项新增或更新
  控制帧       `: ping` 心跳、`event: caught_up` 补发完成（都不落库、不占 seq）
注意：`cancelled` 是 `run.` 族里的一个 type，**不是第 7 个族** —— data-model §2.4 的
type 前缀白名单只有 6 个，新造前缀会让 S2 的 CHECK 直接写失败。
硬性要求写进文档：
  1. id 字段 = 该讨论内的 seq（字符串化整数），每个持久事件都要带；`: ping` 心跳不带。
  2. 断线补发语义是 exclusive：只补 seq > Last-Event-ID 的事件。
  3. 六族事件不得共用同一个 payload 结构；状态与 transcript 禁止混装（spec H1）。
  4. 写明"前端不得依靠事件到达顺序推断业务顺序，一律以 seq 为准"（AC-2.9）。
  5. **每个 type 后面标上它覆盖哪条 AC**；找不到 AC 的 type 就是过度设计，写清楚理由或删掉。

做完只输出两个文件 + 你识别出的协议风险点（最多 3 条）。不要写实现。
```

---

## S2 · 工程骨架 + 迁移 + seed ｜ SDD → 实现

- **输入**：`data-model.md`、`contracts/openapi.yaml`
- **允许改**：根配置、`server/**`、`shared/**`、`web/**`（仅脚手架）、`scripts/**`
- **验收**：`pnpm -C server test` 绿；`curl :8787/health` 返回 `{status:ok, db:ok, llm:missing|configured}`（**永远 200**）；库里 9 张表 + 5 条样例

```
已读 AGENTS.md。本次执行 S2：工程骨架 + 迁移 + seed。允许改的目录：
package.json, pnpm-workspace.yaml, tsconfig*, .gitignore, .env.example,
server/**, shared/**, web/**（仅脚手架）, scripts/**
输入：specs/001-panel/data-model.md、specs/001-panel/contracts/openapi.yaml

要做四件事，按顺序：
1. pnpm workspace：web / server / shared 三个包，TS strict，Vitest 配好。
2. server：Fastify 起在 8787，实现 GET /health（按 contracts/openapi.yaml 的 HealthStatus：**永远 200**，body 含 status/db/llm/now；Key 未配置时 llm=missing，不返回 5xx）。
3. 迁移：server/src/db/migrations/001_init.sql，严格按 data-model.md 建 9 张表，
   加 events(discussion_id, seq) 唯一索引。写一个 migrate.ts 幂等执行。
4. seed：server/src/db/seed.ts 写入 5 条样例讨论，**每场的 status 决定它能带什么**
   （严格按 data-model.md §6 的表）：
   finished ×3（1 主持 + 4 专家、8–12 条发言含 1 条 summary、共识/分歧各 2 条且 final、有 summary_text）
   ready ×1（locked=1、有 agent_status、**0 条发言**）
   draft ×1（locked=0、**0 条发言**、**无 agent_status**）
   **不写 running 样例**（没有调度器会永久占用并发名额）。
   重复执行不产生脏数据（按 sample=1 先删后建）。
5. shared/schemas/：用 zod 定义 Guest / Turn / Event / Ledger / ConsensusPoint /
   DivergencePoint，类型从 schema 推导，不要手写 interface。

约束：不要接 LLM，不要写前端页面，不要写 README。
验收：我要看到 —— pnpm install 成功；pnpm -C server test 绿（至少 1 个 health 测试）；
curl http://localhost:8787/health 返回 {status:ok, db:ok, llm:missing}；脚本能打印出 9 张表的行数。
做完只汇报：改动文件树、三条验收命令的真实输出、遗留问题。
```

---

## S3 · 嘉宾生成与锁定 ｜ SDD（防幻觉第一关）

- **输入**：`shared/schemas/guest.ts`、`contracts/openapi.yaml`
- **允许改**：`server/src/modules/guest/**`、`server/src/llm/**`、`server/test/guest/**`
- **验收**：5 条单测全绿（合规 / 字段缺失 / 人数不符 / 颜色重复 / 重复调用 409）

```
已读 AGENTS.md。本次执行 S3：嘉宾生成与锁定。允许改：
server/src/modules/guest/**, server/src/llm/**, server/test/guest/**
输入：shared/schemas/guest.ts、specs/001-panel/contracts/openapi.yaml

实现 POST /api/discussions/:id/guests/generate：
1. 模型调用必须走 server/src/llm/ 下的唯一出口（新建 llm/client.ts），
   Key 只从 process.env.DEEPSEEK_API_KEY 读，缺失时抛明确错误，不许 fallback 到假数据。
2. 用 JSON 模式输出 1 位主持人 + N 位专家，字段严格按 Guest schema：
   name / profession / stance / color_id / role(host|expert) / speakingOrder
3. 拿到响应后必须用 zod 二次校验；不合法就带着错误信息重试 1 次；仍不合法返回 422，
   并把原始输出写进服务端日志（注意：不得写进任何返回给前端的字段）。
4. 校验通过后写入 guests 表，**locked=0**（同一事务内先 DELETE 该讨论 locked=0 的旧行，再看情况插入；
   这样"确认前反复点生成"只会替换阵容，不会越点越多）。
   若该讨论已有 locked=1 的嘉宾，返回 409 GUESTS_ALREADY_LOCKED，不许覆盖、不许追加。
5. color_id 必须在 10 色板（amber/rose/sky/emerald/violet/orange/teal/lime/indigo/fuchsia）内
   且互不重复，重复视为校验失败。

> 注意：`confirm`（锁阵容 + 建 agent_status + 写 agent.status 事件）**不在本轮做**。
> 它依赖 S6 的事件总线，放在 S6 末尾实现。

测试（先写 test 再写实现）：
  - 合规输出 → 5 条（1 主持 + 4 专家）落库且 locked=0
  - 缺 profession → 触发一次重试，重试后成功
  - 人数与 expert_count 不符 → 422
  - color_id 重复 → 422
  - 已有 locked=1 时再 generate → 409；locked=0 时再 generate → 旧行被替换、行数仍为 5

验收：pnpm -C server test -- guest 全绿，并把失败→通过的两次输出都贴给我。
```

---

## S4 · 主持人账本 ｜ TDD 前置

> **这是全项目的心脏。** 用 AutoGen Magentic-One 的 progress ledger 模式：
> 每轮让模型吐一个 JSON 决策，同时拿到"下一个谁说话""说什么类型""要不要停"。
>
> **本轮结构与 S3 对齐**：S3 是「prompt + 校验 + 重试 + 落库」，S4 是「prompt + 校验 + 重试 + 返回账本」。
> 照着 S3 的 `lineup.ts` / `generate.ts` 分工写，别另起一套。

- **输入**：`contracts/events.md` §7、`shared/schemas/ledger.ts`、`server/src/modules/guest/lineup.ts`（照它的校验风格写）
- **允许改**：`server/src/modules/host/prompt.ts`（新建）、`server/src/modules/host/ledger.ts`（新建）、`shared/schemas/ledger.ts`、`server/test/host/ledger.test.ts`（新建）
- **验收**：`pnpm -C server test -- ledger` 全绿；`llm_calls` 里出现 `module='ledger'` 的行

### 三条硬边界（违反任意一条 = 本轮作废）

1. **`module: 'ledger'` 必须由调用方显式传**。`llm.complete({ module: 'ledger', … })`。
   上一轮 `client.ts` 把 module 写死成 `'guest'`，33 条测试全绿但审计表全错 —— 修好之后
   **每个模块自己负责传对的 module**，client 不再兜底。
2. **不许新建第二个 LLM client**。注入 `ChatJsonClient`（`server/src/llm/client.ts` 的类型），
   不许 import 任何模型 SDK、不许写 `fetch(`、不许读 `process.env`。
   自查：`grep -n "fetch(\|process.env\|openai" server/src/modules/host` 必须为空。
3. **停摆计数必须是入参出参**。`prev_stall_count` 进、`stall_count` 出，函数内不许有
   `let stall = 0` 这类模块级或闭包级状态；同一组输入调用两次必须得到完全相同的输出。

```
已读 AGENTS.md 与 server/src/modules/guest/lineup.ts。本次执行 S4：主持人账本。
只允许新建/修改这四个文件：
  server/src/modules/host/prompt.ts
  server/src/modules/host/ledger.ts
  shared/schemas/ledger.ts
  server/test/host/ledger.test.ts
不要碰：llm/client.ts、app.ts、guest/**、任何迁移与 seed。

【硬边界，违反即作废】
1. llm.complete 必须传 module: 'ledger'（类型是 shared 的 LlmModule）。
2. 不得新建 LLM client、不得 import 模型 SDK、不得写 fetch(、不得读 process.env。
3. stall_count 只能作为入参进、出参出；不得有模块级状态。

【接口，按这个签名写】
export interface LedgerContext {
  discussion_id: number;
  topic: string;
  roster: { id: number; name: string; profession: string; stance: string }[];  // 只放 locked=1
  recent_turns: { guest_id: number; speaker_name: string; speech_type: string; content: string }[];
  expert_turn_count: number;   // 已发生的专家发言条数
  prev_stall_count: number;    // 上一轮的停摆计数
}

export interface LedgerOutcome {
  parse_status: 'structured' | 'json_mode' | 'fallback';
  is_request_satisfied: boolean;
  is_in_loop: boolean;
  is_progress_being_made: boolean;
  next_guest_id: number | null;      // 已解析成 roster 里的 id；fallback 时是最久未发言者
  next_speaker_name: string | null;  // 原始名字，供 ledger.raw_json 复盘
  speech_type: SpeechType | null;    // fallback 时固定 'supplement'
  instruction: string | null;
  stall_count: number;               // 出参，0..3
  raw: string;                       // 最后一次模型原文，供 ledger.raw_json
  issues: string[];
}

export async function requestLedger(
  llm: ChatJsonClient,
  ctx: LedgerContext,
): Promise<LedgerOutcome>

【prompt.ts】
- buildLedgerMessages(ctx)：拼 system + user。
- buildLedgerRetryMessages(messages, issues)：在原消息后追加一段"上次哪里不合法"的反馈。
- 嘉宾名单每轮重新拼进 system prompt，并写明"你只能从这份名单里选人，名单外的人不存在"。
- 写明"每次发言 1–2 句""如果已有 3 位以上嘉宾表达过同一立场，不要再让人重复该立场"。
- 要求纯 JSON、每项都有 reason 和 answer，字段名照 shared/schemas/ledger.ts。

【ledger.ts】
- parseLedger(raw)：剥掉 ```json 围栏后 JSON.parse，失败返回 null（不抛）。
- validateLedger(obj, roster)：zod 校验 + 额外校验 next_speaker 必须 ∈ roster 的 name。
- requestLedger 流程（严格两层，别搞成三层）：
    第 1 次 → 通过 → parse_status = 'structured'
    不通过 → 带 issue 路径重试 1 次（llm.complete({ isRetry: true })）→ 通过 → 'json_mode'
    仍不通过 → fallback：parse_status = 'fallback'，next_guest_id = 最久未发言者，speech_type = 'supplement'
  fallback 不是第三次重试。
- computeStallDelta(is_in_loop, is_progress_being_made, prev)：
    (is_in_loop || !is_progress) ? min(prev + 1, 3) : max(prev - 1, 0)
- 本轮不写库、不发事件。持久化（ledger 表、agent_status、events）在 S6.5 的 runner。

【测试，必须全部包含】
1. 正常 JSON → parse_status='structured'，next_guest_id 正确
2. 带 ```json 围栏 → 仍能解析
3. 缺 reason → 触发重试，第二次通过 → parse_status='json_mode'
4. next_speaker 不在 roster → 重试后仍非法 → fallback，且 next_guest_id = 最久未发言者
5. 两次都非法 → fallback，speech_type='supplement'
6. stall：连续 2 次无进展 → 2；第 3 次 → 3；再来一次仍封顶 3；有进展时 -1 且不低于 0
7. 同一输入调用两次 → LedgerOutcome 完全一致（证明无状态）
8. **审计归属**：跑完一次 requestLedger 后，llm_calls 对应行的 module === 'ledger'
   —— 这是上一轮 module 写死的回归测试，必须有，别省

验收：pnpm -C server test -- ledger 全绿，并贴出第 8 条测试的输出。
```

---

## S5 · 调度决策纯函数 ｜ TDD

- **输入**：`server/src/modules/host/ledger.ts` 的 `LedgerOutcome` / `LedgerContext` 类型（S4 产出）
- **允许改**：`server/src/modules/host/decide.ts`、`server/test/host/decide.test.ts`
- **验收**：先贴 9 条红，再贴全绿；`decide.ts` 里 grep 不到 `Date.now` / `Math.random` / `fetch` / `db` / `llm`

```
已读 AGENTS.md。本次执行 S5：调度决策纯函数。允许改：
server/src/modules/host/decide.ts, server/test/host/decide.test.ts

第一步：只写测试，不写实现，9 条全红，把红色输出贴给我：
1. 正常账本 → 返回 {action:'speak', guest_id, speech_type, instruction}
2. next_speaker 不在名单 → 降级为最久未发言者
3. is_request_satisfied=true → 返回 {action:'summarize'}
4. 连续 3 次 is_in_loop → 返回 {action:'force_stop', reason:'loop'}
5. 同一嘉宾连续发言 2 次 → 强制换人
6. 已发言轮次达到上限 → {action:'summarize'}
7. 嘉宾名单为空 → 抛明确错误，不返回 undefined
8. 输入对象不可变：调用后原 transcript 数组长度不变
9. 跨轮状态不外挂：`decide(input)` 的 `input` 里带 `prev_stall_count`，返回值里带 `stall_count`；
   同一组输入调用两次必须得到完全相同的结果（含 stall_count），证明它没有藏状态

第二步：实现 decide()，满足全部 9 条。
硬约束：不得出现 Date.now / Math.random / fetch / 任何 db import / 任何 llm import。
时间戳和随机源必须作为参数注入（测试才好写）。
验收：先给我 8 条失败的输出，再给全绿的输出。
```

---

## S6 · SSE 事件总线 ｜ TDD

- **输入**：`contracts/events.md`
- **允许改**：`server/src/modules/sse/**`、`server/test/sse/**`
- **验收**：两个讨论并发订阅不串；`Last-Event-ID` 只补 `seq >` 的部分；断开后定时器清掉

```
已读 AGENTS.md。本次执行 S6：SSE 事件总线。允许改：
server/src/modules/sse/**, server/src/modules/guest/confirm.ts, server/test/sse/**
输入：specs/001-panel/contracts/events.md

实现：
1. bus.ts：内存里 Map<discussion_id, Set<subscriber>>，提供 publish(discussion_id, event)
   与 subscribe(discussion_id, lastEventId, res)。
2. 每个事件写进 events 表（discussion_id + seq 自增），再推给该讨论的订阅者。
   **只推给同 discussion_id 的订阅者**，这是隔离的唯一保证。
3. 订阅时若带 Last-Event-ID，先从 events 表补 seq > 该值的事件，补完发一个
   `event: caught_up`，再进入实时态。
4. 响应头：Content-Type: text/event-stream; charset=utf-8、
   Cache-Control: no-cache, no-transform、X-Accel-Buffering: no，
   立刻 flushHeaders。
5. 心跳 15s 一次，帧内容 ": ping"，不写 id。
6. res 的 close/error 触发清理：清 interval、从 Set 移除、interval 必须 unref。
7. 客户端断开时，如果该讨论没有其他订阅者，不得因此中止讨论（讨论是持久任务）。
8. **额外提供 `publishEphemeral(discussionId, type, payload)`**：只推给订阅者、不写表、不带 id。
   `turn.delta` 不落库，走不了 `publish()` —— 这是它唯一的合法推送路径。白名单只允许
   `turn.delta`，其他 type 传进来直接抛错（防止有人用它绕过 events 表）。
9. 最后补上 `POST /api/discussions/:id/guests/confirm`（新建 server/src/modules/guest/confirm.ts）：
   单事务内 —— 校验 guest 行数 = expert_count + 1；全部 locked 置 1；为每位嘉宾建一行
   agent_status(state='idle')；**为每位嘉宾写一条 agent.status 事件**（updated_seq 取该事件 seq，
   不许留 0）；讨论 status 置 ready。行数不符返回 409 GUEST_COUNT_MISMATCH。

测试：
  - 两个 discussion 各 publish 5 条，两个订阅者互不串（断言各自收到 5 条且 id 正确）
  - Last-Event-ID=3 时只补 4,5 并收到 caught_up
  - 断开后 Set 大小归零
  - confirm 后 agent_status 行数 = 嘉宾数，且每行 updated_seq > 0
  - publishEphemeral('turn.delta') 推送成功且 events 表行数不变；
    publishEphemeral('turn.done') 抛错
验收：pnpm -C server test -- sse 全绿 + 我手动并发 curl 两个流不串
（Windows 上必须用 curl.exe，PowerShell 的 curl 是 Invoke-WebRequest 别名，-N 不存在）。
```

---

## S6.5 · 讨论生命周期 + 主循环 ｜ TDD（补漏 Session）

> **这一轮原本不存在，是审查发现的窟窿。** 没有它，S8 的"真跑一场"永远做不到：
> 没有任何 Session 认领 `modules/discussion/`（5 个 REST 端点）和"开场→循环→收尾"的主循环。

- **输入**：`contracts/openapi.yaml`（discussions / start / cancel）、`events.md`、S4/S5 的 `decide.ts`、S6 的 `publish()`
- **允许改**：`server/src/modules/discussion/**`、`server/src/modules/turn/runner.ts`、`server/src/modules/summary/extract.ts`、`server/src/modules/host/interject.ts`、`server/test/discussion/**`、`server/test/runner/**`
- **验收**：`pnpm -C server test -- runner` 全绿 + 手动 HTTP 跑完一整场

```
已读 AGENTS.md。本次执行 S6.5：讨论生命周期 + 主循环 + 增量提炼器 + 主持人追问。允许改：
server/src/modules/discussion/**, server/src/modules/turn/runner.ts,
server/src/modules/summary/extract.ts, server/src/modules/host/interject.ts,
server/test/discussion/**, server/test/runner/**

A. 讨论 CRUD（modules/discussion/）
   1. POST /api/discussions        —— 建 draft，写 state.draft 事件（seq=1），返回 id
   2. GET  /api/discussions        —— 支持 ?active=1；按 updated_at 倒序；只返回摘要字段
   3. GET  /api/discussions/{id}   —— 讨论 + 阵容（guests），**不得**带 turns/共识/分歧/agent_status
   4. POST /{id}/start             —— 仅 ready 可 start；先查 status='running' 是否已达 3 场
                                     （超限 409 TOO_MANY_RUNNING）；置 running + 写 state.running
                                     + run.started，然后**异步**启动 runner（不阻塞响应，5s 内返回）
   5. POST /{id}/cancel            —— draft/generating/ready/running 均可；置 cancelled，
                                     finished_at=now，error_code 保持 NULL，写 state.cancelled + run.cancelled，
                                     通知 runner 停止（AbortController），此后不得再产生 turn
   状态读写全部走 modules/discussion/status.ts 的单一计算函数（H8），REST 与 SSE 共用。

B. 主循环（modules/turn/runner.ts）
   async function runDiscussion(discussionId, signal)
   1. 主持人开场：让 host 生成 opening，走「一笔发言写入单元」（data-model §5）
   2. while (未结束 && !signal.aborted):
        a. 调 decide()（S5 的纯函数）拿 {action, guest_id, speech_type, instruction}
           —— 输入必须包含上一轮的 stall_count，并把它作为返回值传回（不要存在模块级变量里）
           ⚠️ **stall 只有 S4 一个来源**：`requestLedger` 已经算过 `stall_count`，`decide` 只是原样带回。
           所以 runner 必须把**本轮** `ledger.stall_count` 作为**下一轮**的 `prev_stall_count` 传进去。
           传成上一轮的旧值 → 丢一轮 +1 → 停摆晚一轮才触发，而且所有单测照样全绿。
           transcript 必须包含主持人 turn（开场 + 追问），`decide` 换人时只看最后一条**专家**发言。
        b. action='speak' → agent_status 置 preparing → 调模型拿 1–2 句 → speaking → 落 turns
           → turn.done → idle
        c. 每完成 2 条专家发言 → 调 summary/extract.ts 提炼，写 provisional 条目 + 事件
        d. **每完成 4 条专家发言 → 调 host/interject.ts 让主持人插一条追问**（见 D）
        e. action='summarize' / 'force_stop' → 跳出
   3. 收尾：生成 summary（150–250 字）→ 写 turns(speech_type='summary') **并在同一事务里**
      回填 discussions.summary_text（INV-9：两者逐字相同）→ state.finished + run.finished
   4. 任何一步致命失败 → status='failed' + run.failed，不留半写状态
   5. signal.aborted → 直接 return，不写 finished

C. 增量提炼器（modules/summary/extract.ts）
   extractPoints(transcript, roster) → { consensus: string[], divergence: string[] }
   规则：每次只看最近 4 条发言；输出必须是中文一句话 ≤120 字；
   与已有文本重复的不新增（靠 uq_consensus_text 兜底）；写入 status='provisional'。
   模型调用必须走 server/src/llm/，且记录 llm_calls(module='summary')。

D. 主持人追问（modules/host/interject.ts）—— AC-1.25，F3 的"追问/串联"
   buildInterjectMessages(ctx) + generateInterjection(llm, ctx) → string（≤120 字）
   触发：每累计 4 条专家发言一次（4/8/12/16/20），由 runner 调用，**不经过 ledger**。
   内容要求（写进 prompt）：必须引用最近发言里的具体观点（点名某位嘉宾说过的话），
   并把它推向最分歧或最没展开的地方；不要复述、不要总结、不要评价"大家说得都很好"。
   写入：走同一「一笔发言写入单元」，guest_id = 主持人的 id，speech_type='question'。
   **不计入 expert_turn_count，不触发提炼窗口。**
   模型调用记录 llm_calls(module='turn')（它属于发言生成，不属于调度）。

测试（先红后绿）：
  - start 一个 draft 讨论 → 409 INVALID_STATE_TRANSITION
  - 已有 3 场 running 时再 start → 409 TOO_MANY_RUNNING
  - runner 用 fake LLM 跑完一场 → turns ≥ 6、至少 1 条 summary、status=finished、
    summary_text 与 summary turn 的 content 逐字相等
  - 每 2 条专家发言后 consensus_points 行数增加
  - **12 条专家发言后恰好出现 3 条 speech_type='question' 的 turn，且 guest 是 host**
    （4/8/12 各一次）；这些 turn 没有让 expert_turn_count 增加
  - **stall 串联**：连续 3 轮 `is_in_loop=true` 的 fake 账本 → 第 3 轮就返回 force_stop
    （不是第 4 轮）。这条专门抓"runner 把 stall 传断链"——传旧值的话前三轮测试全绿，只有这条会红
  - cancel 后 runner 停止，turns 行数不再增加，status=cancelled 且 error_code IS NULL
验收：pnpm -C server test -- runner 全绿；并给我一段"curl 建讨论 → start → 等 30s → 查详情"
的真实输出（status 应为 finished，turns 应有若干条，且能看到主持人追问穿插其中）。
```

---

## S7 · 三个页面 + 演播厅布局 ｜ DDD

> 关键：这一轮**全部用假数据**，只做壳。壳不塌，后面才敢接线。
> **三页都要做**：`HomeView`（列表 + 新建表单）、`GuestConfirmView`（确认阵容）、`TheaterView`（演播厅）。
> 原计划只写 Theater，首页与确认页会掉地上，S10 的 E2E 第 1/3 步直接跑不了。

- **输入**：`docs/DESIGN.md`（视觉契约，必读）、`web/src/styles/tokens.css`、`web/src/styles/atoms.css`、本节的 ASCII 线框
- **允许改**：`web/src/views/**`、`web/src/components/**`（`common/` 只允许**新增**，不得重写已有 5 个基础件）、`web/src/router/**`、`web/src/mock/**`
- **技能**：本 Session 必须加载 `impeccable`（品味），但**落点必须是 `DESIGN.md` 的 token**（一致）
- **验收**：9 张截图 + 高度断言 + `grep` 无色值 + 一致性自查 6 问

**线框（文字版，照这个做）**

```
首页 HomeView
┌──────────────────────────────────────────────┐
│  AI PANEL STUDIO            [+ 发起新讨论]   │
├──────────────────────────────────────────────┤
│  进行中                                       │
│  ┌────────────────────────────────────────┐  │
│  │ 议题标题            [5 位嘉宾]  ● running│  │
│  │ 更新于 2 分钟前                [加入观察]│  │
│  └────────────────────────────────────────┘  │
│  已结束                                       │
│  ┌────────────────────────────────────────┐  │
│  │ 议题标题            [5 位嘉宾]  ✓ finished│ │
│  │ 一句话总结预览…              [查看记录] │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
新建表单：议题输入框（1–200 字计数）+ 专家人数步进器（1–8，默认 4）+ [生成嘉宾]

确认页 GuestConfirmView
┌──────────────────────────────────────────────┐
│  ← 返回      确认本场阵容（4 位专家 + 1 主持）│
├──────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ ● 色块  │ │ ●       │ │ ●       │        │
│  │ 姓名     │ │ 姓名    │ │ 姓名    │        │
│  │ 职业     │ │ 职业    │ │ 职业    │        │
│  │ 立场一句话│ │ 立场    │ │ 立场    │        │
│  └─────────┘ └─────────┘ └─────────┘        │
│                          [重新生成] [确认阵容]│
└──────────────────────────────────────────────┘

演播厅 TheaterView（三栏 + 顶部状态条 + 底部运输条）
┌───────────────────────────────────────────────────────────┐
│ ● LIVE   议题标题                    4 位专家   [退出]     │  header (auto)
├──────────┬────────────────────────────────┬───────────────┤
│ 阵容      │  Transcript（独立滚动）          │ 共识 / 分歧    │
│ ● 主持    │  主持人 · 开场                   │ 共识           │
│ ● 专家A   │  专家A · 挑战  「…」             │  · 一条        │
│  preparing│  专家B · 反驳  「…」             │ 分歧           │
│ ● 专家B   │  …                              │  · 一条        │
│  speaking │                                 │               │
│ ● 专家C   │                                 │               │
│  idle     │                                 │               │
├──────────┴────────────────────────────────┴───────────────┤
│  第 8 / 20 条 · 进行中              [取消讨论]              │  transport (auto)
└───────────────────────────────────────────────────────────┘
```

**S7 开场提示词**

```
已读 AGENTS.md 与 docs/DESIGN.md。本次执行 S7：三个页面 + 演播厅布局壳，全部用假数据。
允许改：web/src/views/**, web/src/components/**（common/ 只可新增，不得重写已有 5 个基础件）,
        web/src/router/**, web/src/mock/**
不要碰：web/src/styles/**（token 已冻结）、任何 api/、stores/、server/ 文件。
不要接 SSE、不要发请求。

0. 开工前先做三件事，做完先回我一句确认再继续：
   a. 读 docs/DESIGN.md 全文；
   b. 读 web/src/styles/tokens.css 与 atoms.css，列出你打算用到的 token；
   c. 确认 web/src/components/common/ 下已有 AppButton / AppCard / AppBadge / AppPanel / AppEmpty，
      以及 styles/expert-colors.ts 的 expertColorStyle()。
   **本轮不允许发明新的色值、字号、间距、圆角**。缺什么就停下来告诉我，不要自己补。
   所有颜色必须走 var(--…)，所有专家色必须走 expertColorStyle()。

三个页面（按上面线框做）：
1. HomeView        —— 列表分「进行中 / 已结束」两组 + 新建讨论表单（议题输入 + 人数步进器）
2. GuestConfirmView —— 5 张嘉宾卡（姓名 / 职业 / 立场 / 色块）+ 重新生成 / 确认阵容
3. TheaterView     —— 三栏 + 各面板独立滚动 + 顶部状态条 + 底部运输条

布局硬要求（照做，不要自创）：
1. 根：html, body, #app { height:100%; overflow:hidden }
2. 演播厅必须套两层：
   <div class="studio-shell"><div class="studio">…</div></div>
   .studio-shell { height:100vh; height:100dvh; container-type:inline-size; }
   .studio {
     height:100%; display:grid;
     grid-template-rows: auto minmax(0,1fr) auto;
     grid-template-columns: minmax(0,18rem) minmax(0,1fr) minmax(0,22rem);
     grid-template-areas: "header header header"
                          "roster stage insights"
                          "transport transport transport";
   }
   ⚠️ container-type 必须开在 .studio-shell 上，**绝不能开在 .studio 自己身上、再用
   @container 改它自己的 grid-template-columns** —— container query 只对容器后代生效，
   改不了容器自身。上一版 prompt 就是这么写错的，照抄会变成"写了但永远不触发"。
3. .studio > * { min-width:0; min-height:0 }
4. 每个可滚动面板：overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable;
   内部不要再套一个没有 min-height:0 的 flex/grid 祖先。
5. 响应式分两类写法，别混：
   - 「容器自身」的栅格变化（比如窄屏把三栏变单栏）→ 用 @media，因为它改的是 .studio 自己。
   - 「面板内部的排布」→ 用 @container (max-width: …)，因为容器查询只对后代生效。
   断点：1200px 折叠右侧 insights 为抽屉；900px 变单栏 + 顶部标签切换 roster/stage/insights。
6. 超宽（≥1800px）：加第四栏 OR stage 最大宽度 1600px 居中，二选一，说明理由。
7. 绝对不要用 min-height:100vh 当壳高 —— 文档会滚动，内层 overflow 永远不生效。

组件：RosterPanel / ExpertCard / ExpertStatusBadge / TranscriptFeed / TranscriptItem /
ConsensusBoard / HostBar / DiscussionCard / GuestCard / NewDiscussionForm。
全部接收 props，不自己发请求。
**每个业务组件内部只能用 common/ 的 5 个基础件 + var(--…) 拼出来**：
按钮→AppButton，卡片→AppCard，状态/标签→AppBadge（expert 时传 color_id），
每一栏→AppPanel，空/失败→AppEmpty。不许自己写 <button> 的样式。

假数据写死在一个 mock.ts：1 位主持 + 4 位专家、10 条发言、2 条共识、2 条分歧。

视觉要求：加载 impeccable 技能提升品味，但**所有落点必须是 DESIGN.md 的 token**。
目标是"演播厅"而不是"后台表单"：暗色舞台、专家色块贯穿卡片与 transcript、
状态点三态可辨、共识与分歧分区明显、留白克制、中文长文本不溢出。

交付前必须逐条回答（答不上来说明没做完）：
  1. grep -rn "#[0-9a-fA-F]\{6\}" web/src/components 的输出是什么？（必须是空）
  2. 三页的主操作按钮是不是同一个 AppButton variant="primary"？
  3. 同一个专家在 roster / transcript / 共识区是不是同一组色？（都来自 expertColorStyle）
  4. 空列表 / 加载中 / 失败 三种状态各自长什么样？是否都用了 AppEmpty / 骨架卡片？
  5. 有没有任何一处用了 tokens.css 里不存在的变量名？（grep var(-- 后比对）
  6. prefers-reduced-motion: reduce 下呼吸动画停了吗？

验收：三页各三张截图（1440x900 / 1280x800 / 390x844，共 9 张），
以及演播厅页控制台执行 document.scrollingElement.scrollHeight === window.innerHeight
（必须 true，false 说明壳高写错了）。
做完只汇报：文件清单 + 9 张截图路径 + 断言结果 + 上面 6 问的答案 + 超宽屏方案。
```

---

## S8 · 状态层接线 ｜ DDD

- **输入**：S7 组件 + `contracts/events.md` + `docs/DESIGN.md`（新加的组件也必须用基础件与 token）
- **允许改**：`web/src/stores/**`、`web/src/api/**`、`web/src/views/TheaterView.vue`
- **验收**：真跑一场，五个面板都在动；页面 DOM 里搜不到 `"type":` 之类的 JSON 原文

```
已读 AGENTS.md。本次执行 S8：把真实数据接进 S7 的壳。
允许改：web/src/stores/**, web/src/api/**, web/src/views/TheaterView.vue
不要改：server/**、任何组件内部结构（只能改它的 props 来源）

实现：
1. api/client.ts：fetch 封装，统一错误处理。
2. api/events.ts：**不要用原生 EventSource**。它有三个死穴，正好撞上本项目的三条契约：
   ① 不能自定义请求头（无法带 Last-Event-ID）；② 404 会自动重连（AC-3.6 要求不重连）；
   ③ 无法区分"服务端正常结束"与"网络断开"。
   改用 `fetch(url, { headers: { 'Last-Event-ID': String(lastSeq) }, signal })` +
   `response.body.getReader()` 手写 SSE 解析（按 `\n\n` 切帧，解析 `id:` / `event:` / `data:`），
   自己实现：正常结束不重连、404 不重连、网络错误退避重连（1s→2s→4s，上限 3 次）。
   按事件族分发：state.* / run.* / agent.* / turn.* / consensus.* / divergence.*
3. stores/discussion.ts（Pinia）：
   - 五份互相独立的 state：status、agentStatusMap、turns、consensus、divergence
   - **不许合并成一个大对象**，这是作业的硬性隔离要求
   - turn.delta 追加到当前 turn 的缓冲，turn.done 才落进 turns 数组
   - **turn.started 只用于「正在说」的瞬时提示**，按 `(guest_id, turn_no)` 幂等覆盖，
     不得追加成条目。服务端允许 start 多于 done（发言失败会重试并复用同一 turn_no），
     前端必须容忍孤儿 start —— 见 `events.md` §8.1 的警告。
   - 按 seq 去重（收到 seq <= 已处理最大值就丢弃；无 id 的 delta 不参与去重）
4. 组件只从 store 读，不直接调 api。

验收：真跑一场讨论（后端可用假模型开关），我要看到——
  - transcript 逐条出现，色块与专家一致
  - 专家状态从 preparing → speaking → idle 变化
  - 共识区在中途就新增条目（不是结束才出现）
  - 页面文本里搜不到 `{"`、`"type":`、`{"reason"` 这类原始 JSON
做完只汇报：改了哪些文件、跑了多久的一场、三个现象的截图或文字确认。
```

---

## S9 · 收尾与兜底 ｜ TDD

- **输入**：全部 + `docs/DESIGN.md`（SummaryPanel 的三态必须走 token 与 AppEmpty）
- **允许改**：`server/src/modules/summary/**`、`server/src/modules/turn/**`（仅串联）、`web/src/components/theater/Summary*`
- **验收**：空 transcript、嘉宾全失败、总结超时，三种边界都有兜底

```
已读 AGENTS.md。本次执行 S9：收尾、共识定稿、失败兜底。允许改：
server/src/modules/summary/summary.ts, server/src/modules/summary/merge.ts,
server/src/modules/discussion/retry.ts, web/src/components/theater/SummaryPanel.vue,
server/test/summary/**
注意：**增量提炼（每 2 条专家发言一次）已经在 S6.5 做完了**，本轮只做结束时的定稿。

实现：
1. 结束时总结：把完整 transcript 喂给模型，生成一段**自然语言**总结（150–250 字），
   要求：不复述 JSON、不逐条罗列、要点出主要分歧。
   写两条且必须在同一事务里：
   - `turns(speech_type='summary')` 一行
   - `discussions.summary_text` 逐字等于上一条的 content（INV-9）
   **长度要硬校验，不能只靠 prompt**：S6.5 真跑时 231 字合格，但这只是运气。
   落库前检查 150 ≤ len ≤ 250；不在范围内就重试一次，仍不合法则截断/补齐到边界并记
   `llm_calls(is_retry=1, success=0)`，**不允许**把 88 字或 600 字的"总结"直接写进库。
2. **`support_guest_ids` 必须填**：S6.5 的 extract 目前写空数组，而 F5 的"谁同意"要靠它渲染。
   本轮把提炼产出里的嘉宾姓名映射回 `guests.id` 再落库；映射不到的名字直接丢弃（不要猜）。
   归并时同样要保留/合并 support 列表，不能因为置 final 就清空。
3. 共识/分歧定稿：把 status='provisional' 的条目做一次归并去重，
   保留的置 'final' 并记录 updated_seq；被推翻的置 'dropped'（单向，不得复活）。
4. 兜底：
   - transcript 为空 → 总结写入固定文案「本场讨论未产生有效发言」，status 仍为 finished
   - 全部专家调用失败 → status='failed' + run.failed，前端显示重试按钮
   - 总结调用超时（>30s）→ summary_text 写「总结生成失败，请查看完整记录」，仍置 finished，
     run.finished.summary_failed=true
5. **补一个重试端点**（原计划漏了，S9 的"重试按钮"没有后端就无法闭环）：
   POST /api/discussions/:id/retry-summary
   仅 status='failed' 且 error_code='ALL_SPEAKERS_FAILED' 允许；成功后 status 置 finished
   （或 failed→finished 的补充迁移），写 run.finished；其他状态返回 409 INVALID_STATE_TRANSITION。
   同时在 spec §4.1 状态机补这条迁移（改文档走 Ask first）。
6. 前端 SummaryPanel：loading / success / failed 三态，failed 时可重试（调上面的端点）。

测试：三种兜底各一条 + retry-summary 的前置条件一条，空 transcript 那条必须**先红后绿**。
验收：pnpm -C server test -- summary 全绿。
```

---

## S10 · E2E 闭环 ｜ E2E

- **输入**：`contracts/*`
- **允许改**：`e2e/**`、`playwright.config.ts`、`server/src/llm/fake.ts`、`server/src/llm/index.ts`
- **验收**：`pnpm e2e` 一次通过；产物里有截图；二次运行也通过（可重复）

```
已读 AGENTS.md。本次执行 S10：端到端测试。允许改：
e2e/**, playwright.config.ts, server/src/llm/fake.ts, server/src/llm/index.ts
输入：specs/001-panel/spec.md 的 P1 用户故事与验收标准

写一条完整链路的 Playwright 用例（不是四个独立小用例）：
1. 打开首页 → 看到样例讨论分组（进行中 / 已结束）
2. 新建讨论：输入话题、专家数 4 → 生成嘉宾
3. 嘉宾确认页 → 校验 5 张卡片都有姓名/职业/立场/色块 → 点确认
4. 进入演播厅 → 等待主持人开场发言出现
5. 断言 transcript 至少出现 6 条，每条都有发言人名
6. 断言专家状态徽章至少出现过一次 "speaking"
7. 讨论结束后出现总结文本，且长度 > 50 字
8. 断言页面上不存在原始 JSON（用 page.content() 正则排除 `"reason":`、`"type":"`）
9. 全流程截图存 e2e/screenshots/

约束：模型调用必须走可切换的 fake provider（环境变量 FAKE_LLM=1），否则 E2E 不稳定。
**真调一场要 1–3 分钟**（20 条专家发言 × 每轮 3–7s，再加账本/提炼/追问），
所以 E2E 一律 fake，且如果把真调写进用例，超时必须 ≥ 180s，不能沿用 Playwright 默认 30s。
**本轮允许改 server/src/llm/ 下的文件**（原计划只允许 e2e/**，自相矛盾，已修正）：
新增 fake.ts 实现一个确定性的假 provider（固定返回合法 JSON / 固定文本，可注入延迟），
在 index.ts 里按 FAKE_LLM 选择实现。**不得改动任何业务模块。**

验收：pnpm e2e 跑两遍都绿，把两遍输出和截图目录贴给我。
```

---

## S11 · 文档与提交（人做，不用 AI 或只让它润色）

不是 AI Session，是人的收口。照 `AGENTS.md` §8 的 DoD 逐条打勾：

- [ ] `docs/PROMPT_LOG.md` 至少 5 段，四阶段齐全，每段有"卡点 + 怎么修"
- [ ] `docs/WORK_REPORT.md` 1–1.5 页，含 2–3 个真实问题
- [ ] **`docs/PRD.md`**（交付物原文明确要求 "PRD、ER 图等"，ER 已有，PRD 别漏）
- [ ] `docs/TEST.md` 测试说明（跑什么、覆盖哪些 AC）
- [ ] `README.md` 含：快速开始 / 环境变量（`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`、`PORT`）/ 技术选型理由 / API 列表 / 已完成 / 后续改进
- [ ] **模型名如实写**：实际服务模型是 `deepseek-flash`（`deepseek-chat` 已下线，Pro 档由 flash 承接），
      不要写成自己证不了的型号；`llm_calls` 里存的就是响应返回的真实 model，可直接当证据
- [ ] `git log --oneline` 能看出层级。**约定 commit 前缀**：
      `docs:` → `schema:` → `test:` → `feat:` → `ui:` → `e2e:`
      （作业原文给的示例顺序是 docs/schema → ui → tests → feat → logic；我们的实际顺序更贴近工程节奏，
       在 WORK_REPORT 里用一段话说明为什么，比硬伪造历史强）
- [ ] 仓库邀请 `xule@wisquest.com` 对应账号，并确认已接受
- [ ] 邮件主题含真实姓名（+ BOSS 昵称若不同）
- [ ] 发完邮件截图回传

---

## Prompt 记录怎么自然长出来

每次 Session 结束，往 `docs/PROMPT_LOG.md` 追加一条，格式固定四行：

```markdown
### S4 · 主持人账本（TDD 前置）
**阶段**：TDD
**核心 Prompt**：（贴你实际发的那段，中间可省略）
**意图**：把"谁下一个说话"从隐式轮询改成显式可审计的决策记录，同时拿到防死循环信号。
**卡点**：第一次它把 reason 字段写成了可选，导致坏 JSON 也能通过校验，测试全绿但线上降级失效。
**修正**：贴了 zod 报错原文，要求 reason 必填 + 增加"缺 reason"这条测试，第二次通过。
```

**阶段映射**（保证四阶段齐全、≥5 段）：

| 阶段 | 覆盖的 Session |
|---|---|
| SDD | S0、S1、S2、S3 |
| DDD | S7、S8 |
| TDD | S4、S5、S6、S6.5、S9 |
| E2E | S10 |

> 挑 6–8 条写进文档即可，但**必须是真跑过的**。全是"一次通过"的记录反而不可信。
