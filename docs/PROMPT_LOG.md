# 核心 Prompt 记录

> 交付物之一，必须 ≥5 段，且覆盖 SDD / DDD / TDD / E2E 四个阶段。
> **规则：每完成一个 Session 就追加一条，不要事后补写。** 面试会追问细节。

对应关系见 `docs/SESSION_MAP.md` 最后两节。

格式固定四行：

```markdown
### S{n} · {名称}
**阶段**：SDD / DDD / TDD / E2E
**核心 Prompt**：
```（贴实际发送的那段，中间可用 … 省略）```
**意图**：（当时想解决什么，为什么这么拆）
**卡点**：（它第一次错在哪，你看到了什么证据）
**修正**：（你怎么引导的，第几次通过）
```

---

## 目录（填完把标题补上）

- [x] S0 · 契约冻结 — 阶段：SDD
- [x] S1 · 接口与事件协议 — 阶段：SDD
- [x] S2 · 工程骨架与 seed — 阶段：SDD
- [ ] S3 · 嘉宾生成与锁定 — 阶段：SDD
- [ ] S4 · 主持人账本 — 阶段：TDD
- [ ] S5 · 调度决策纯函数 — 阶段：TDD
- [ ] S6 · SSE 事件总线 — 阶段：TDD
- [ ] S7 · 演播厅布局 — 阶段：DDD
- [ ] S8 · 状态层接线 — 阶段：DDD
- [ ] S9 · 收尾与兜底 — 阶段：TDD
- [ ] S10 · E2E 闭环 — 阶段：E2E

---

### S0 · 契约冻结

**阶段**：SDD（数据建模 + 行为契约）

**核心 Prompt**：

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
 也用来在报告里给出"这场讨论调用了几次模型"的真实数字。不要存 prompt 原文。）
其中 events.seq 必须是「每个 discussion_id 内单调递增」，并说明并发写入怎么保证。
样例数据不加独立表，直接作为普通 discussions/guests/turns 行写入，用 sample=1 标记。

产出 3 —— 歧义清单：
作业没写清的地方不要猜，写成 [NEEDS CLARIFICATION: <具体问题>]
单独列一节给我，我裁决完你再改。

做完只输出三样：两个文件路径、NEEDS CLARIFICATION 清单、你认为最可能有争议的 3 个设计决定。
不要开始写任何代码。
```

（实际执行时在末尾追加了一条：`允许改的文件只有 specs/001-panel/spec.md 和 data-model.md，其他任何文件一律不要碰，不要写代码，不要建目录。` —— 这条是防止它一把梭的关键，删掉它这一轮大概率会顺手把脚手架也搭了。）

**意图**：把"一整场讨论"压缩成两份纯文本契约，让后面 10 个 Session 都只能对着文件写代码，而不是对着聊天记录猜。我要的不是"能跑的代码"，是"后面每一轮都有唯一裁决依据"。所以先冻 `spec.md`（行为）+ `data-model.md`（结构），并用 `[NEEDS CLARIFICATION]` 把作业没写清的地方显式挂起，而不是让它自由发挥。

**卡点**：AI 一次性产出 36 条合规 EARS（脚本校验 36/36 含 `SHALL`）、9 张表齐全、`seq` 用 `discussions.last_event_seq` 计数器 + `BEGIN IMMEDIATE ... RETURNING` 取号（比我预期的 `MAX(seq)+1` 好），看起来可以收工。但逐字段对下来发现 **5 个会在后续阶段爆炸的契约缺陷**：

1. `turns.content` 限 `BETWEEN 1 AND 120`，而 `speech_type='summary'` 的收尾总结要 150–250 字 —— 这条 CHECK 一进迁移，S9 写总结时必定 `SQLITE_CONSTRAINT`。
2. 8 色板 + `uq_guests_color(discussion_id, color_id)` 唯一索引 ⇒ 一场最多 8 位嘉宾；但 `expert_count ∈ [1,8]` 意味着 1 主持 + 8 专家 = 9 行，选满必撞色。
3. `locked` 由谁置 1 没定义：AC-1.4 说"已有 `locked=1` 就 409"，AC-1.7 说 `confirm` 才置 1 —— 那 `generate` 到底锁不锁？两边都成立时 `confirm` 就是死代码；而且"确认前反复点生成"没有任何约束，会越点越多。
4. `agent_status` 在 `confirm` 时建行、`updated_seq` 默认 0，但没有对应的 `agent.*` 事件 —— 破坏了"`events` 是唯一可重放源"：后来的人补发事件时看不到初始状态。
5. 全篇 36 条 AC 里**没有一条在验"不允许机械式轮流发言"**，而这正是作业 F3 的核心考点；只有降级路径，没有正向断言。

另外 7 条 `[NEEDS CLARIFICATION]` 全是我没在需求里写死、必须人来拍板的口径（首页是否含已结束、人数上限、轮的口径、发言上限、cancel 是否独立状态、观察者权限、并发上限）。

**修正**：没有让它自由发挥，而是先出裁决表（7 条全部由人拍板），再让它按裁决回写：

- 色板 8 → **10 色**（加 `indigo` / `fuchsia`），`expert_count` 保持 `[1,8]`；
- `content` 的 CHECK 改成**按 `speech_type` 分支**（专家 ≤120，`opening/summary` ≤400），并把这 6 行 DDL 直接写进 `data-model.md`，防止 S2 建表时又照抄成单一 `BETWEEN`；
- 锁定改成**两段式**：`generate` 写 `locked=0` 且先删旧的 `locked=0` 行，`confirm` 才翻成 1；
- `confirm` 时**逐人写一条 `agent.status` 事件**，`updated_seq` 不许留 0；
- 新增 AC-1.21（`speech_type` 去重 ≥3 种、不连续同一人）补上反轮流考点，另加 AC-1.22/1.23 补 F6 的色块一致与"内部事件不外泄"；
- 取消从 `failed + USER_CANCELLED` 改成**独立终态 `cancelled`**（`error_code` 恒 NULL），并加 `CHECK (status <> 'cancelled' OR error_code IS NULL)`。

改完 36 → 43 条 AC，全部含 `SHALL`。另有一处**结构性返工**：`confirm` 依赖事件总线，而事件总线在 S6 才有 —— 原计划把 `confirm` 放 S3 会直接 import 一个不存在的 `publish()`，已挪到 S6 末尾实现。

**教训（写进工作说明用）**：AI 在"格式合规"和"局部设计合理性"上表现很好，在"跨阶段耦合"上几乎必错 —— 它不知道 S9 会写 200 字总结，也不知道 S3 早于 S6。所以契约阶段的审查重点不是语法，是**每一条约束在未来哪个 Session 会被触发**。

---

### S1 · 接口契约与事件协议

**阶段**：SDD（API 契约 + 事件协议）

**核心 Prompt**：

```
已读 AGENTS.md 与 specs/001-panel/spec.md（v1.0 已冻结）。
本次执行 S1：接口契约与事件协议。只允许新建：
  specs/001-panel/contracts/openapi.yaml
  specs/001-panel/contracts/events.md
输入：spec.md、data-model.md

openapi.yaml 覆盖这 9 个端点，每个都要有成功响应 + 至少 1 个错误响应，
错误码与 spec.md §4.2 逐字一致：
  GET  /api/discussions（?active=1）/ POST /api/discussions / GET /api/discussions/{id}
  POST /{id}/guests/generate / POST /{id}/guests/confirm
  POST /{id}/start / POST /{id}/cancel
  GET  /{id}/events（text/event-stream）/ GET /health

events.md 定义 SSE 协议，每个族列出所有 type + payload 字段 + 触发时机 + 对应 AC 编号。
硬性要求：
  1. id = 该讨论内 seq（字符串化整数），每个持久事件必带；`: ping` 心跳不带。
  2. 补发 exclusive：只补 seq > Last-Event-ID。
  3. run.cancelled 与 run.failed 是两个不同事件，payload 不得共用结构。
  4. 各族不得共用 payload；状态与 transcript 禁止混装（spec H1）。
  5. 前端以 seq 为准，不得到达顺序推断业务顺序（AC-2.9）。
  6. 每个 type 后面标上它覆盖哪条 AC，缺 AC 的 type 说明你多造了。

做完只输出两个文件 + 你识别出的协议风险点（最多 3 条）。不要写实现。
```

**意图**：把 spec 的 43 条 AC 翻译成"机器可校验"的两份东西 —— 一份是 REST 的形状（谁进谁不进），一份是事件流的形状（id/补发/去重）。这一轮的价值不在"写了 838 行 YAML"，在于**逼它自己把 spec 里没想清的地方暴露出来**（比如 delta 到底有没有 seq）。所以我要求每个 type 必须挂 AC 编号 —— 挂不上的就是过度设计。

**卡点**：它交回 19 个 type + 2 个控制帧，AC 覆盖矩阵齐全，还主动报了 3 条协议风险。三条里有两条是真问题，一条是**我自己 Prompt 写错造成的**：

1. （**我的错**）我在 Prompt 里写"7 个事件族"，但 `data-model.md` §2.4 的 `events.type` 前缀白名单只有 6 个。它没有照抄，而是指出"`cancelled` 只能落在 `run.` 族内，第 7 组只能是控制帧；若要真造第 7 个前缀，S2 的 CHECK 会直接写失败"。**它纠正了指令里的错误，这是这次协作里最值得记的一笔。**
2. （**真问题，风险最高**）`turn.delta` 不落库 ⇒ 没有 seq ⇒ 不在补发范围、也不在 AC-2.9 的去重规则覆盖内。它明确警告"S6 千万别给 delta 补 id，否则等于在 seq 序列里插假号"。
3. （**它只说对一半**）它报"spec 字段命名混排"，实际比我以为的严重：`events.md` 全套 camelCase（`guestId` / `turnNo` / `speechType`），而 `openapi.yaml` 的 `Guest` 对象是 snake + camel 混着（`discussion_id` / `speaking_order` / `color_id` 旁边一个 `colorId`）。这是**两套线上格式**，不是一处笔误。

另外我自查发现一个它没提的：`/health` 在 Key 缺失时返回 500 `LLM_NOT_CONFIGURED`。而 S2 的验收是"curl /health 返回 ok"，S2 阶段本来就没有 Key —— **这条会让 S2 第一次验收就红**，是我写 S0/S2 时埋的雷。

**修正**：没有让它重写，而是先定三条口径再回写：

- **命名**：全线 snake_case（API JSON = SSE payload = zod key = DB 列名），零映射层。用脚本对 `events.md` / `openapi.yaml` / `spec.md` 做了 19 个 token 的批量替换（`guestId→guest_id`、`speechType→speech_type`…），随后 `yaml.safe_load` 复核 8 个 path item / 9 个 operation，`Guest.required` 与新属性名一致。并在 `AGENTS.md` 补第 10 条不变量锁死这条规则，防止 S2 又转回 camel。
- **事件族口径**：定稿为 **6 个持久族 + 2 个控制帧**（`: ping`、`caught_up`），`cancelled` 落在 `run.*` 内。同步改掉 `SESSION_MAP` 里我写错的"7 族"。
- **delta 定位**：在 AC-1.9 里补一句 —— delta 不带 `id`、不参与 seq 去重与补发，断线期间丢失由 `turn.done.content` 整体覆盖。把它的口头警告固化成契约，否则 S6/S8 各理解一版。
- **/health**：改成**永远 200**，body 自述 `{status, db, llm, now}`，`llm=missing` 是配置状态不是故障；业务请求的 Key 缺失仍走 AC-1.6 的 500。同时把 S2 的验收断言从"返回 ok"改成完整 body 形状。

**教训**：AI 提出的"风险点"要分开看 —— 有些是它的发现（delta 无 seq 属真问题），有些是**我的 Prompt 与上游文档打架**（7 个族）。后者更危险，因为它会顺着指令做出一个合规但违背上层的实现。所以每次它报风险，第一件事是回去核对我自己的指令，而不是直接采信或直接驳回。

---

### S2 · 工程骨架 + 迁移 + seed

**阶段**：SDD → 实现

**核心 Prompt**：

```
已读 AGENTS.md。本次执行 S2：工程骨架 + 迁移 + seed。允许改的目录：
package.json, pnpm-workspace.yaml, tsconfig*, .gitignore, .env.example,
server/**, shared/**, web/**（仅脚手架）, scripts/**
输入：specs/001-panel/data-model.md、specs/001-panel/contracts/openapi.yaml

1. pnpm workspace：web / server / shared 三个包，TS strict，Vitest 配好。
2. server：Fastify 起在 8787，GET /health 按 contracts/openapi.yaml 的 HealthStatus
   （永远 200，body 含 status/db/llm/now；Key 未配置时 llm=missing，不返回 5xx）。
3. 迁移：server/src/db/migrations/001_init.sql 严格按 data-model.md 建 9 张表，
   加 events(discussion_id, seq) 唯一索引；migrate.ts 幂等。
4. seed：5 条样例讨论，每场 status 决定它能带什么（finished ×3 / ready ×1 / draft ×1，
   draft 0 条 turns 且无 agent_status），重复执行不产生脏数据。
5. shared/schemas/：zod 定义 Guest / Turn / Event / Ledger / ConsensusPoint / DivergencePoint，
   类型从 schema 推导，不手写 interface。

约束：不接 LLM，不写前端页面，不写 README。
```

**意图**：把两份契约变成可执行的地基 —— 9 张表、5 条能撑起首页和演示的样例、一套前后端共用的 zod。这一轮的价值不是"跑起来了"，而是**后面每个模块都能拿真实数据写测试**。所以我要求 seed 必须能重放（events 齐套），否则 S8 的"观察一场"永远没法验证。

**卡点**：这一轮交回来的东西**表面完全合格**：`pnpm check` 20 个测试全绿、9 张表建对、`turns.content` 的双分支 CHECK 也照抄对了。但把 SESSION_MAP 全文对着代码读了一遍之后，发现真正的问题不在 S2 本身，而在**计划与代码的接缝**，一共 26 处，其中 10 处会让某个 Session 直接做不完：

- **4 个模块没有任何 Session 认领**：`modules/discussion`（5 个 REST 端点）、主循环 `turn/runner.ts`、首页 + 嘉宾确认页、以及 F5 要求的"每 2 条发言增量提炼"。S9 的允许改列表写的是"`turn/runner.ts`（仅串联）"—— 它以为这文件已经存在，但没人负责创建。
- **seed 的三条样例是"怪物"**：`running` 场没有调度器，永久卡住且永久占用 AC-2.10 的并发名额；`draft` 场被硬编码 `locked=1` 还带 8 条发言和 `agent_status`，点"确认"会撞 `uq_agent_status_guest` 500。根因是 `data-model.md` §6 自己打架：要求"每场 locked=1"同时要求"≥1 场 draft"。
- **契约自相矛盾 10 处**：`createdAt` 仍是 camel（我上一轮批量替换漏了这个 token，而且 `event.ts` 里还写着 `by contract` 把错误固化了）；openapi `servers` 是 3000 而服务在 8787；`DiscussionDetail = allOf[Summary, …]` 而 Summary 带 `additionalProperties: false`（JSON Schema 语义下 allOf 的另一支会被全部判为多余属性）；`/health` 直接读 `process.env`，破了自己定的 H5。
- **两条 prompt 里埋了必然失败的指令**：S7 让 `container-type: inline-size` 开在 `.studio` 上、再用 `@container` 改它自己的 `grid-template-columns` —— 容器查询只对后代生效，这个写法"写了但永远不触发"；S8 让原生 `EventSource` 带 `Last-Event-ID` 且 404 不重连 —— 这两件事它都做不到。

**修正**：没有推翻重写，按"文档先于代码"的顺序修：

1. **补一个 S6.5**（讨论生命周期 + 主循环 + 增量提炼器），明确允许改 `modules/discussion/**`、`turn/runner.ts`、`summary/extract.ts`。这是本次最大的一处结构性补漏。
2. **S7 从"只做演播厅"扩成三页**，并把不存在的 `docs/layout-sketch.png` 换成内联 ASCII 线框（缺文件时 AI 会自己编布局，"照做不要自创"就落空）；`container-type` 移到外层 `.studio-shell`，并写清"容器自身的栅格变化用 `@media`，面板内部用 `@container`"。
3. **S8 改成 `fetch + ReadableStream`**，自己实现重连与 404 不重连。
4. **seed 按 status 分档**：`draft` 0 条发言 / `locked=0` / 无 `agent_status`，`ready` 有阵容无发言，`running` 样例直接删掉（改为第 3 场 `finished` 并补 150–250 字总结）。测试同步改成按状态断言。
5. **契约收口**：`createdAt → created_at`（三处，包括那句 `by contract` 注释）；`servers` 3000 → 8787；`DiscussionSummary` 去掉 `additionalProperties: false` 并写明原因；`app.ts` 的 env 读取抽到 `llm/config.ts`，让 H5 重新成立。
6. `data-model.md` 补 INV-9（`summary_text` 必须逐字等于 summary turn）、`preparing` 的写入方、seed 写 `events` 的显式例外。

改完 `pnpm check` 仍全绿（20 tests），`db:seed` 输出 5 discussions / 25 guests / 31 turns / 6+6 points / 127 events / 20 agent_status，与 §6 的表逐项对得上。

**教训**：**单轮测试全绿 ≠ 计划可执行。** 这一轮的缺陷没有一条能被 `pnpm test` 抓到，全部藏在"Session A 的产出喂不进 Session B"的接缝里。所以每完成一个 Session，除了跑本轮的验收命令，还要做一次"下一轮能不能开工"的反向检查：它需要的输入文件存在吗？它被允许改的目录里有没有它要创建的模块？没有这一步，绿测试会一直骗人到 S8 才崩。

---
