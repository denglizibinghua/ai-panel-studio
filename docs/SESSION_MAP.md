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
| S4 | 主持人账本 | TDD 前置 | schema + contracts | ledger 提示词 + 解析 + 校验 + 停摆计数 | `pnpm -C server test -- ledger` | 3h |
| S5 | 调度决策纯函数 | TDD | ledger schema | 先红后绿的 `decide.ts` | `pnpm -C server test -- decide` | 2h |
| S6 | SSE 事件总线 | TDD | contracts/events.md | 每讨论一条流 + 序号补发 + 清理 | 并发 curl + 补发测试 | 3h |
| S7 | 演播厅布局 | DDD | 手绘布局草图 | 三栏 + 独立滚动 + 三档断点 | 3 张截图 + 高度断言 | 3h |
| S8 | 状态层接线 | DDD | S7 + events.md | EventSource → store → 五面板 | 真跑一场 | 3h |
| S9 | 收尾与兜底 | TDD | 全部 | 自然语言总结 + 共识定稿 + 失败兜底 | 边界用例 | 2h |
| S10 | E2E 闭环 | E2E | contracts | 一条完整 Playwright 用例 | `pnpm e2e` | 2h |
| S11 | 文档与提交 | — | 全部 | Prompt 记录 / 工作说明 / README / 邮件 | 打勾清单 | 2h |

**合计 ≈ 29h 的"AI 协作工时"，实际墙钟约 12–15h**，留足返工和睡觉。

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

events.md 定义 SSE 事件协议，7 个事件族，每个族列出所有 type + payload 字段
+ 触发时机 + 对应 AC 编号：
  state.*      讨论状态变化（含 cancelled 终态）
  run.*        run.started / run.finished / run.failed / run.cancelled（后两者不得共用 payload）
  agent.*      专家状态（idle/preparing/speaking）+ focus 文本
  turn.*       turn.started / turn.delta / turn.done
  consensus.*  共识项新增或更新
  divergence.* 分歧项新增或更新
硬性要求写进文档：
  1. id 字段 = 该讨论内的 seq（字符串化整数），每个持久事件都要带；`: ping` 心跳不带。
  2. 断线补发语义是 exclusive：只补 seq > Last-Event-ID 的事件。
  3. 七族事件不得共用同一个 payload 结构；状态与 transcript 禁止混装（spec H1）。
  4. 写明"前端不得依靠事件到达顺序推断业务顺序，一律以 seq 为准"（AC-2.9）。
  5. **每个 type 后面标上它覆盖哪条 AC**；找不到 AC 的 type 就是过度设计，写清楚理由或删掉。

做完只输出两个文件 + 你识别出的协议风险点（最多 3 条）。不要写实现。
```

---

## S2 · 工程骨架 + 迁移 + seed ｜ SDD → 实现

- **输入**：`data-model.md`、`contracts/openapi.yaml`
- **允许改**：根配置、`server/**`、`shared/**`、`web/**`（仅脚手架）、`scripts/**`
- **验收**：`pnpm -C server test` 绿；`curl :8787/health` 返回 ok；库里 9 张表 + 5 条样例

```
已读 AGENTS.md。本次执行 S2：工程骨架 + 迁移 + seed。允许改的目录：
package.json, pnpm-workspace.yaml, tsconfig*, .gitignore, .env.example,
server/**, shared/**, web/**（仅脚手架）, scripts/**
输入：specs/001-panel/data-model.md、specs/001-panel/contracts/openapi.yaml

要做四件事，按顺序：
1. pnpm workspace：web / server / shared 三个包，TS strict，Vitest 配好。
2. server：Fastify 起在 8787，实现 GET /health 返回 {ok:true}。
3. 迁移：server/src/db/migrations/001_init.sql，严格按 data-model.md 建 9 张表，
   加 events(discussion_id, seq) 唯一索引。写一个 migrate.ts 幂等执行。
4. seed：server/src/db/seed.ts 写入 5 条完整样例讨论（每场 1 主持 + 4 专家 = **5 行 guests**、
   8–12 条发言、2 条共识、2 条分歧、齐套 events、每位嘉宾一条 agent.status 事件），
   供首页列表和演示用；重复执行不产生脏数据（按 sample=1 重建）。
5. shared/schemas/：用 zod 定义 Guest / Turn / Event / Ledger / ConsensusPoint /
   DivergencePoint，类型从 schema 推导，不要手写 interface。

约束：不要接 LLM，不要写前端页面，不要写 README。
验收：我要看到 —— pnpm install 成功；pnpm -C server test 绿（至少 1 个 health 测试）；
curl http://localhost:8787/health 返回 ok；脚本能打印出 9 张表的行数。
做完只汇报：改动文件树、三条验收命令的真实输出、遗留问题。
```

---

## S3 · 嘉宾生成与锁定 ｜ SDD（防幻觉第一关）

- **输入**：`shared/schemas/guest.ts`、`contracts/openapi.yaml`
- **允许改**：`server/src/modules/guest/**`、`server/src/llm/**`、`tests/guest/**`
- **验收**：5 条单测全绿（合规 / 字段缺失 / 人数不符 / 颜色重复 / 重复调用 409）

```
已读 AGENTS.md。本次执行 S3：嘉宾生成与锁定。允许改：
server/src/modules/guest/**, server/src/llm/**, tests/guest/**
输入：shared/schemas/guest.ts、specs/001-panel/contracts/openapi.yaml

实现 POST /api/discussions/:id/guests/generate：
1. 模型调用必须走 server/src/llm/ 下的唯一出口（新建 llm/client.ts），
   Key 只从 process.env.DEEPSEEK_API_KEY 读，缺失时抛明确错误，不许 fallback 到假数据。
2. 用 JSON 模式输出 1 位主持人 + N 位专家，字段严格按 Guest schema：
   name / profession / stance / colorId / role(host|expert) / speakingOrder
3. 拿到响应后必须用 zod 二次校验；不合法就带着错误信息重试 1 次；仍不合法返回 422，
   并把原始输出写进服务端日志（注意：不得写进任何返回给前端的字段）。
4. 校验通过后写入 guests 表，**locked=0**（同一事务内先 DELETE 该讨论 locked=0 的旧行，再看情况插入；
   这样"确认前反复点生成"只会替换阵容，不会越点越多）。
   若该讨论已有 locked=1 的嘉宾，返回 409 GUESTS_ALREADY_LOCKED，不许覆盖、不许追加。
5. colorId 必须在 10 色板（amber/rose/sky/emerald/violet/orange/teal/lime/indigo/fuchsia）内
   且互不重复，重复视为校验失败。

> 注意：`confirm`（锁阵容 + 建 agent_status + 写 agent.status 事件）**不在本轮做**。
> 它依赖 S6 的事件总线，放在 S6 末尾实现。

测试（先写 test 再写实现）：
  - 合规输出 → 5 条（1 主持 + 4 专家）落库且 locked=0
  - 缺 profession → 触发一次重试，重试后成功
  - 人数与 expert_count 不符 → 422
  - colorId 重复 → 422
  - 已有 locked=1 时再 generate → 409；locked=0 时再 generate → 旧行被替换、行数仍为 5

验收：pnpm -C server test -- guest 全绿，并把失败→通过的两次输出都贴给我。
```

---

## S4 · 主持人账本 ｜ TDD 前置

> **这是全项目的心脏。** 用的是 AutoGen Magentic-One 的 progress ledger 模式：
> 每轮让模型吐一个 JSON 决策，同时拿到"下一个谁说话""说什么类型""要不要停"。

- **输入**：`shared/schemas/ledger.ts`、`contracts/events.md`
- **允许改**：`server/src/modules/host/ledger.ts`、`server/src/modules/host/prompt.ts`、`shared/schemas/ledger.ts`、`tests/host/ledger*`
- **验收**：坏 JSON / 缺 reason / 点名不存在的嘉宾，三种情况都有明确降级

```
已读 AGENTS.md。本次执行 S4：主持人账本。允许改：
server/src/modules/host/ledger.ts, server/src/modules/host/prompt.ts,
shared/schemas/ledger.ts, tests/host/ledger.test.ts
输入：specs/001-panel/contracts/events.md、shared/schemas/*.ts

实现「progress ledger」：每一轮把「议题 + 已锁定嘉宾名单 + 最近 6 条发言」喂给模型，
要求它输出严格 JSON，schema 如下（每项都要有 reason 和 answer）：
{
  "is_request_satisfied": {"reason": string, "answer": boolean},
  "is_in_loop":           {"reason": string, "answer": boolean},
  "is_progress_being_made":{"reason": string,"answer": boolean},
  "next_speaker":         {"reason": string, "answer": "<嘉宾 name，必须来自名单>"},
  "speech_type":          {"reason": string, "answer": "challenge|supplement|rebuttal|question|summary"},
  "instruction":          {"reason": string, "answer": "<给这位嘉宾的一句具体指令>"}
}

prompt.ts 要求：
- 嘉宾名单每轮重新拼进 system prompt（不要依赖历史记忆），并明确写
  "你只能从这份名单里选人，名单外的人不存在"。
- 明确写"每次发言 1–2 句，禁止长篇"。
- 明确写"如果已有 3 位以上嘉宾表达过同一立场，就不要再让人重复该立场"。

ledger.ts 要求：
- parseLedger(raw)：从可能带 markdown 围栏的输出里取出 JSON，失败返回 null。
- validateLedger(obj, guestNames)：zod 校验 + 额外校验 next_speaker ∈ guestNames。
- 三级降级：结构化输出 → json 模式 → 解析失败则返回 fallback（选最久未发言者，speech_type=supplement）。
- 停摆计数：is_in_loop 或 !is_progress_being_made 各 +1，否则 -1（下限 0）；到 3 次返回 stop 信号。
- 这里只做纯解析与决策，不要发请求、不要写库。

测试必须覆盖：正常 JSON / 带 ```json 围栏 / 缺 reason / next_speaker 不在名单 / 连续 3 次无进展。
验收：pnpm -C server test -- ledger 全绿。
```

---

## S5 · 调度决策纯函数 ｜ TDD

- **输入**：`ledger.ts` 的类型
- **允许改**：`server/src/modules/host/decide.ts`、`tests/host/decide.test.ts`
- **验收**：先贴 8 条红，再贴全绿；`decide.ts` 里 grep 不到 `Date.now` / `fetch` / `db`

```
已读 AGENTS.md。本次执行 S5：调度决策纯函数。允许改：
server/src/modules/host/decide.ts, tests/host/decide.test.ts

第一步：只写测试，不写实现，8 条全红，把红色输出贴给我：
1. 正常账本 → 返回 {action:'speak', guestId, speechType, instruction}
2. next_speaker 不在名单 → 降级为最久未发言者
3. is_request_satisfied=true → 返回 {action:'summarize'}
4. 连续 3 次 is_in_loop → 返回 {action:'force_stop', reason:'loop'}
5. 同一嘉宾连续发言 2 次 → 强制换人
6. 已发言轮次达到上限 → {action:'summarize'}
7. 嘉宾名单为空 → 抛明确错误，不返回 undefined
8. 输入对象不可变：调用后原 transcript 数组长度不变

第二步：实现 decide()，满足全部 8 条。
硬约束：不得出现 Date.now / Math.random / fetch / 任何 db import / 任何 llm import。
时间戳和随机源必须作为参数注入（测试才好写）。
验收：先给我 8 条失败的输出，再给全绿的输出。
```

---

## S6 · SSE 事件总线 ｜ TDD

- **输入**：`contracts/events.md`
- **允许改**：`server/src/modules/sse/**`、`tests/sse/**`
- **验收**：两个讨论并发订阅不串；`Last-Event-ID` 只补 `seq >` 的部分；断开后定时器清掉

```
已读 AGENTS.md。本次执行 S6：SSE 事件总线。允许改：
server/src/modules/sse/**, server/src/modules/guest/confirm.ts, tests/sse/**
输入：specs/001-panel/contracts/events.md

实现：
1. bus.ts：内存里 Map<discussionId, Set<subscriber>>，提供 publish(discussionId, event)
   与 subscribe(discussionId, lastEventId, res)。
2. 每个事件写进 events 表（discussion_id + seq 自增），再推给该讨论的订阅者。
   **只推给同 discussionId 的订阅者**，这是隔离的唯一保证。
3. 订阅时若带 Last-Event-ID，先从 events 表补 seq > 该值的事件，补完发一个
   `event: caught_up`，再进入实时态。
4. 响应头：Content-Type: text/event-stream; charset=utf-8、
   Cache-Control: no-cache, no-transform、X-Accel-Buffering: no，
   立刻 flushHeaders。
5. 心跳 15s 一次，帧内容 ": ping"，不写 id。
6. res 的 close/error 触发清理：清 interval、从 Set 移除、interval 必须 unref。
7. 客户端断开时，如果该讨论没有其他订阅者，不得因此中止讨论（讨论是持久任务）。

8. 最后补上 `POST /api/discussions/:id/guests/confirm`（新建 server/src/modules/guest/confirm.ts）：
   单事务内 —— 校验 guest 行数 = expert_count + 1；全部 locked 置 1；为每位嘉宾建一行
   agent_status(state='idle')；**为每位嘉宾写一条 agent.status 事件**（updated_seq 取该事件 seq，
   不许留 0）；讨论 status 置 ready。行数不符返回 409 GUEST_COUNT_MISMATCH。

测试：
  - 两个 discussion 各 publish 5 条，两个订阅者互不串（断言各自收到 5 条且 id 正确）
  - Last-Event-ID=3 时只补 4,5 并收到 caught_up
  - 断开后 Set 大小归零
  - confirm 后 agent_status 行数 = 嘉宾数，且每行 updated_seq > 0
验收：pnpm -C server test -- sse 全绿 + 我手动并发 curl 两个流不串。
```

---

## S7 · 演播厅布局 ｜ DDD

> 关键：这一轮**全部用假数据**，只做壳。壳不塌，后面才敢接线。

- **输入**：`docs/layout-sketch.png`（你自己手画拍照）
- **允许改**：`web/src/views/TheaterView.vue`、`web/src/components/theater/**`、`web/src/styles/**`
- **验收**：1440 / 1280 / 390 三张截图；`document.scrollingElement.scrollHeight === innerHeight`

```
已读 AGENTS.md。本次执行 S7：演播厅布局壳，全部用假数据。
允许改：web/src/views/TheaterView.vue, web/src/components/theater/**,
web/src/styles/**, web/src/router（仅注册路由）
不要碰：任何 api/、stores/、server/ 文件。不要接 SSE。

布局硬要求（照做，不要自创）：
1. 根：html, body, #app { height:100%; overflow:hidden }；.studio { height:100vh; height:100dvh; }
   绝对不要用 min-height:100vh —— 那会让文档滚动，内层 overflow 永远不生效。
2. .studio 用 Grid：
   grid-template-rows: auto minmax(0,1fr) auto;
   grid-template-columns: minmax(0,18rem) minmax(0,1fr) minmax(0,22rem);
   grid-template-areas: "header header header" "roster stage insights" "transport transport transport";
3. .studio > * { min-width:0; min-height:0 }
4. 每个可滚动面板：overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable;
   并且它内部不要再套一个没有 min-height:0 的 flex/grid 祖先。
5. 用 container-type: inline-size 开在 .studio 上，断点判断用 @container 而不是 @media
   —— 1440 屏上有 18rem+22rem 侧栏时舞台只有约 800px，@media 不会触发。
6. 断点：
   @container (max-width: 1200px) → 右侧 insights 折叠成抽屉按钮，stage 占两栏
   @container (max-width: 900px)  → 单栏 + 顶部标签切换 roster/stage/insights
7. 超宽（≥1800px）：加第四栏 OR stage 最大宽度 1600px 居中，二选一，说明理由。

组件拆分：RosterPanel / ExpertCard / ExpertStatusBadge / TranscriptFeed /
TranscriptItem / ConsensusBoard / HostBar。全部接收 props，不自己发请求。

假数据：**1 位主持 + 4 位专家**、10 条发言、2 条共识、2 条分歧，写死在一个 mock.ts 里。

验收：我要三张截图（1440x900 / 1280x800 / 390x844），以及控制台执行
document.scrollingElement.scrollHeight === window.innerHeight 的结果（必须 true）。
做完只汇报文件清单 + 截图路径 + 那条断言结果。
```

---

## S8 · 状态层接线 ｜ DDD

- **输入**：S7 组件 + `contracts/events.md`
- **允许改**：`web/src/stores/**`、`web/src/api/**`、`web/src/views/TheaterView.vue`
- **验收**：真跑一场，五个面板都在动；页面 DOM 里搜不到 `"type":` 之类的 JSON 原文

```
已读 AGENTS.md。本次执行 S8：把真实数据接进 S7 的壳。
允许改：web/src/stores/**, web/src/api/**, web/src/views/TheaterView.vue
不要改：server/**、任何组件内部结构（只能改它的 props 来源）

实现：
1. api/client.ts：fetch 封装，统一错误处理。
2. api/events.ts：EventSource 封装，支持断开重连并带上 Last-Event-ID，
   按事件族分发：state.* / run.* / agent.* / turn.* / consensus.* / divergence.*
3. stores/discussion.ts（Pinia）：
   - 五份互相独立的 state：status、agentStatusMap、turns、consensus、divergence
   - **不许合并成一个大对象**，这是作业的硬性隔离要求
   - turn.delta 追加到当前 turn 的缓冲，turn.done 才落进 turns 数组
   - 按 seq 去重（收到 seq <= 已处理最大值就丢弃）
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

- **输入**：全部
- **允许改**：`server/src/modules/summary/**`、`server/src/modules/turn/**`（仅串联）、`web/src/components/theater/Summary*`
- **验收**：空 transcript、嘉宾全失败、总结超时，三种边界都有兜底

```
已读 AGENTS.md。本次执行 S9：收尾、共识定稿、失败兜底。允许改：
server/src/modules/summary/**, server/src/modules/turn/runner.ts,
web/src/components/theater/SummaryPanel.vue

实现：
1. 讨论结束时，把完整 transcript 喂给模型，生成一段**自然语言**总结（150–250 字），
   要求：不复述 JSON、不逐条罗列、要点出主要分歧。
   服务端只返回纯文本字符串，前端直接渲染。
2. 共识/分歧定稿：把 status='provisional' 的条目做一次归并去重，
   保留的置 'final' 并记录 updated_seq；被推翻的置 'dropped'，前端淡出。
3. 兜底：
   - transcript 为空 → 总结返回固定文案"本场讨论未产生有效发言"
   - 全部发言人调用失败 → 讨论置 failed，SSE 推 run.failed，前端显示重试按钮
   - 总结调用超时（>30s）→ 返回"总结生成失败，请查看完整记录"，不阻塞结束态
4. 前端 SummaryPanel：loading / success / failed 三态，failed 时可重试。

测试：三种兜底各一条，空 transcript 那条必须先红后绿。
验收：pnpm -C server test -- summary 全绿。
```

---

## S10 · E2E 闭环 ｜ E2E

- **输入**：`contracts/*`
- **允许改**：`e2e/**`、`playwright.config.ts`
- **验收**：`pnpm e2e` 一次通过；产物里有截图；二次运行也通过（可重复）

```
已读 AGENTS.md。本次执行 S10：端到端测试。允许改：
e2e/**, playwright.config.ts
输入：specs/001-panel/spec.md 的 P1 用户故事与验收标准

写一条完整链路的 Playwright 用例（不是四个独立小用例）：
1. 打开首页 → 看到 5 条样例讨论
2. 新建讨论：输入话题、专家数 4 → 生成嘉宾
3. 嘉宾确认页 → 校验 4 张卡片都有姓名/职业/立场/色块 → 点确认
4. 进入演播厅 → 等待主持人开场发言出现
5. 断言 transcript 至少出现 6 条，每条都有发言人名
6. 断言专家状态徽章至少出现过一次 "speaking"
7. 讨论结束后出现总结文本，且长度 > 50 字
8. 断言页面上不存在原始 JSON（用 page.content() 正则排除 `"reason":`、`"type":"`）
9. 全流程截图存 e2e/screenshots/

约束：模型调用必须走可切换的 fake provider（环境变量 FAKE_LLM=1），
否则 E2E 不稳定。如果 S2 没留这个开关，先加上再写测试，但只在
server/src/llm/ 内加，不许改业务代码。

验收：pnpm e2e 跑两遍都绿，把两遍输出和截图目录贴给我。
```

---

## S11 · 文档与提交（人做，不用 AI 或只让它润色）

不是 AI Session，是人的收口。照 `AGENTS.md` §8 的 DoD 逐条打勾：

- [ ] `docs/PROMPT_LOG.md` 至少 5 段，四阶段齐全，每段有"卡点 + 怎么修"
- [ ] `docs/WORK_REPORT.md` 1–1.5 页，含 2–3 个真实问题
- [ ] `README.md` 含：快速开始 / 环境变量 / 技术选型理由 / API 列表 / 已完成 / 后续改进
- [ ] `git log --oneline` 呈现 `docs → schema → ui → tests → feat` 的层级
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
| TDD | S4、S5、S6、S9 |
| E2E | S10 |

> 挑 6–8 条写进文档即可，但**必须是真跑过的**。全是"一次通过"的记录反而不可信。
