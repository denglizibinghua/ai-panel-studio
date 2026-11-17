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
- [x] S3 · 嘉宾生成与锁定 — 阶段：SDD
- [x] S4 · 主持人账本 — 阶段：TDD
- [x] S5 · 调度决策纯函数 — 阶段：TDD
- [x] S6 · SSE 事件总线 — 阶段：TDD
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

### S3 · 嘉宾生成与锁定（只做 generate，不碰 lock）

**阶段**：SDD

**核心 Prompt**：SESSION_MAP 的 S3 段 + 两条追加硬约束（fake 注入、不碰 confirm）。

```
已读 AGENTS.md。本次执行 S3：嘉宾生成与锁定。允许改：
server/src/modules/guest/**, server/src/llm/**, server/test/guest/**
输入：shared/schemas/guest.ts、specs/001-panel/contracts/openapi.yaml

实现 POST /api/discussions/:id/guests/generate：
1. 模型调用必须走 server/src/llm/ 下的唯一出口，Key 只从 process.env.DEEPSEEK_API_KEY 读，
   缺失时抛明确错误，不许 fallback 到假数据。
2. JSON 模式输出 1 位主持人 + N 位专家，字段严格按 Guest schema。
3. zod 二次校验；不合法带错误信息重试 1 次；仍不合法返回 422，原始输出只进服务端日志。
4. 校验通过后写入 guests 表，locked=0（同一事务先 DELETE 该讨论 locked=0 的旧行）。
   已有 locked=1 的嘉宾 → 409，不许覆盖。
5. color_id 必须在 10 色板内且互不重复。

追加约束：
A. 单测一律注入 fake client，任何用例不得打真实网络；测试开头 delete process.env.DEEPSEEK_API_KEY，
   让漏到默认 transport 的路径立刻在 LLM_NOT_CONFIGURED 炸掉，而不是偷偷打真接口。
B. confirm 不在本轮：不得出现 /guests/confirm 路由、不得写 agent_status、不得改 discussions.status。
```

**意图**：嘉宾是整场讨论的"事实基座"——后面所有发言都只能引用这里落库的行。所以真正要防的不是"模型生成得难看"，而是**脏数据进库**：人数不符、颜色撞车、重复点击越点越多。要求的顺序是"校验全过才落库 + 单事务替换旧行"，把库当成唯一可信来源，而不是让内存里的半成品有机会流出去。

**卡点**：四条，前三条都不在测试覆盖范围内。

1. **`llm_calls.module` 被硬编码成 `'guest'`**：INSERT 写死了字面量，请求对象上的 `module` 字段实际是死的。S3 自己看不出来——这轮只有 guest 一种调用，33 条测试全绿。但 S4 的 ledger、S6.5 的 turn/summary 一接进来，审计表会把所有调用记成 guest，"按模块核算额度""这场讨论调了几次模型"会整体失真。根因是我写 prompt 时只说了"每次尝试写一行 llm_calls"，没说 module 要透传。
2. **`llm_calls.success` 语义写反**：初版是"上游返回就算成功"，于是 422 那些校验失败的尝试被记成成功。data-model §2.9 写的是"校验通过才算 1"。它自己发现，改成注入 `validate` 谓词——这条给分。
3. **超时被归到 422**：spec §4.3 写"嘉宾生成 30s → 422 `GUEST_OUTPUT_INVALID`"，openapi 的 422 描述也列了"超 30s"；但 spec §4.2 里 `LLM_UPSTREAM_ERROR` 的定义恰恰是"模型服务不可用 / 超时"。**契约自己跟自己打架**，实现按 500 做并主动上报。
4. **测试目录与文档不一致**：SESSION_MAP 全篇写 `tests/**`，仓库既有约定是 `server/test/**`（S2 的三个文件都在那）。它按现实走并记了一笔。

**修正**：

- `shared/schemas/enums.ts` 补 `export type LlmModule`；`client.ts` 的 `module` 改成 `LlmModule`，由 `req.module` 真正透传进 INSERT。**必须在 S4 之前修**，否则 S4 的全部测试会建立在错误的审计口径上。
- 契约收口：spec §4.3 改为"500 `LLM_UPSTREAM_ERROR`（传输超时）；校验不合法才是 422"，openapi 的 422 描述删掉"超 30s"并补一句反向说明。判据：**422 表示"你给我的东西我消化不了"，超时表示"我没拿到东西"**。
- 文档统一：AGENTS §5 目录地图 + SESSION_MAP 全部 13 处 `tests/` → `server/test/`；AGENTS §0 里那行临时备注撤回（阶段指针只放阶段）。

**教训**：**"这一轮测不出来"的缺陷，才是最容易活到下一轮的那种。** `module: 'guest'` 在当前 33 条测试里 100% 正确——因为没有第二种调用。它会在 S4 变成一张全错的审计表，而 S4 的测试照样会绿。所以每个 Session 收尾要多问一句：**这个实现里，有没有哪个常量是因为"目前只有一种情况"才成立的？**

**真调验收（测试之外，手工跑一次）**：对 seed 的 draft 场打真实接口，绕开所有 fake。

```
POST /api/discussions/5/guests/generate   → HTTP 200，2359ms
返回：1 host + 4 experts，color_id 互不重复，speaking_order 0..4，locked=false
llm_calls 落库：module=guest / model=deepseek-flash / 2331ms
                prompt=255 / completion=245 / total=500 / is_retry=0 / success=1
DB 核对：5 行 guests 全部 locked=0
```

这一次证明了 fake 测不到的三件事：DeepSeek 的 JSON mode 请求体合法、`choices[0].message.content` 取法正确、`usage` 字段名对得上。同时暴露一个命名事实——**实际服务方返回的 model 是 `deepseek-flash`，不是我们在请求里写的 `deepseek-chat`**；审计表存的是响应里的真实模型名（`result.model ?? model`），所以这个偏差被如实记录，没有被掩盖。

已核实：`deepseek-chat` 这个型号已经下线，**Pro 档目前由 `deepseek-flash` 承接**。因此默认模型名改成 `deepseek-flash` 并支持 `DEEPSEEK_MODEL` 覆盖 —— 写工作说明时按"实际使用 DeepSeek（当前服务模型 `deepseek-flash`，对应作业文中的 V4 Pro 档）"来写，不要写一个自己证不了的名字。

---

### S4 · 主持人账本

**阶段**：TDD 前置

**核心 Prompt**：SESSION_MAP 的 S4 段原文（逐字照抄，三条硬边界不删）。

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
  expert_turn_count: number;
  prev_stall_count: number;
}

export interface LedgerOutcome {
  parse_status: 'structured' | 'json_mode' | 'fallback';
  is_request_satisfied: boolean;
  is_in_loop: boolean;
  is_progress_being_made: boolean;
  next_guest_id: number | null;
  next_speaker_name: string | null;
  speech_type: SpeechType | null;
  instruction: string | null;
  stall_count: number;
  raw: string;
  issues: string[];
}

export async function requestLedger(llm: ChatJsonClient, ctx: LedgerContext): Promise<LedgerOutcome>

【prompt.ts】
- buildLedgerMessages(ctx)：拼 system + user。
- buildLedgerRetryMessages(messages, issues)：在原消息后追加"上次哪里不合法"的反馈。
- 名单每轮重新拼进 system，写明"你只能从这份名单里选人，名单外的人不存在"。
- 写明"每次发言 1–2 句""如果已有 3 位以上嘉宾表达过同一立场，不要再让人重复该立场"。
- 要求纯 JSON、每项都有 reason 和 answer，字段名照 shared/schemas/ledger.ts。

【ledger.ts】
- parseLedger(raw)：剥掉 ```json 围栏后 JSON.parse，失败返回 null（不抛）。
- validateLedger(obj, roster)：zod 校验 + next_speaker 必须 ∈ roster 的 name。
- requestLedger 严格两层：第 1 次通过 → 'structured'；不通过带 issue 重试 1 次
  （isRetry: true）→ 通过 → 'json_mode'；仍不通过 → fallback（最久未发言者，
  speech_type='supplement'）。fallback 不是第三次重试。
- computeStallDelta(is_in_loop, is_progress, prev)：循环或没进展 +1（封顶 3），有进展 -1（保底 0）。
- 本轮不写库、不发事件；持久化归 S6.5 runner。

【测试（8 条必须全含）】
1. 正常 JSON → 'structured'，next_guest_id 正确
2. ```json 围栏 → 仍能解析
3. 缺 reason → 重试后通过 → 'json_mode'
4. next_speaker 不在 roster → 重试仍非法 → fallback，next_guest_id = 最久未发言者
5. 两次都非法 → fallback，speech_type='supplement'
6. stall：连续 2 次无进展 → 2；第 3 次 → 3；再来仍 3；有进展 -1 且不低于 0
7. 同一输入调用两次 → LedgerOutcome 完全一致（证明无状态）
8. 审计归属：requestLedger 后 llm_calls 对应行 module === 'ledger'
```

**意图**：这是全项目的心脏。不是"让模型随便挑个人说话"，而是每轮把"谁发言 / 什么类型 / 该不该收尾"压缩成一个**可校验、可复盘、可降级**的 JSON 决策。三条硬边界分别锁三件事：审计口径（module 由调用方传）、依赖收口（只有 `llm/` 一个出口）、可重放（同一个输入必须得到同一个账本）。只要第 7、8 条在，S4 就跑不偏。

**实现决定**（超出 Prompt 字面、需要留档）：

1. **决策 JSON 与 `ledger` 表行分开**：`shared/schemas/ledger.ts` 里原有的 `ledgerSchema`（DB 行）一字未动，只新增 `llmLedgerDecisionSchema`（6 项，每项 `{reason, answer}`）。落库投影归 S6.5，S4 只产 `LedgerOutcome`。
2. **`roster` 传"可发言名单"（专家），host 由调用方过滤**：接口按 Prompt 原文不含 `role`，所以 host 不能混进来，否则"最久未发言者"永远命中主持人。此约定写进了 `LedgerContext.roster` 的注释，S6.5 必须遵守。
3. **fallback 的停摆仍 +1**：解析失败当作"没有进展"（`is_in_loop=false`、`is_progress_being_made=false`），走同一个 `computeStallDelta`，不给 fallback 开小灶。
4. **传输层错误直接上抛，不吞成 fallback**：LLM 挂掉是 `LLM_UPSTREAM_ERROR`，由 S6.5 runner 决定 `run.failed`；把它伪装成"输出不合法"会污染 `parse_status` 的语义。
5. **`reason` 上限 300、`instruction` 上限 200**：后者照 data-model §2.5 的列约束；前者只为挡住无限长理由把 `raw_json` 撑爆（≤4096）。

**卡点**：无返工。唯一需要盯的是 `pnpm -C server test -- ledger` 的过滤名——vitest 按文件名匹配，`ledger` 恰好只命中本轮文件；若后续出现 `ledger-*.test.ts` 会连带跑，验收时要看文件数。

**教训**：**纯函数的边界不在函数体，在参数表。** 这轮"不许藏状态"如果只靠"函数里没写 `let`"来证，是证不出来的——`pickMostStaleMember` 里也有 `let`。真正的证明是第 7 条：同一 `ctx` 两次调用、`toEqual`。写测试时先问"哪个断言能让错误实现也变红"，再决定要不要写它。

**验收**：

```
$ pnpm -C server test -- ledger
✓ test/host/ledger.test.ts (9 tests) 34ms
Test Files  1 passed (1)
     Tests  9 passed (9)

$ pnpm check
shared tsc --noEmit ✓  server tsc --noEmit ✓  vitest run → 6 files / 42 tests passed

$ grep -E "fetch\(|process\.env|openai" server/src/modules/host/*.ts
（无输出）
```

第 8 条测试实测：注入 transport + 临时 db，跑一次 `requestLedger` 后 `llm_calls` 落一行
`discussion_id=<本场> / module='ledger' / is_retry=0 / success=1`。

**审查补记（独立复核，判定期）**：

三条硬边界全部守住，复核通过：`grep -E "fetch\(|process\.env|openai" server/src/modules/host` 无输出；
`module: 'ledger'` 由 `requestAttempt` 显式传入；`computeStallDelta` 纯函数、`pickMostStaleMember` 的 `let` 都是局部变量且第 7 条用 `toEqual` 锁死了。

但发现一个**测试永远抓不到的缺口 —— 不是代码错，是契约漏了需求**：

> F3 原文："主持人负责开场、追问、串联和总结"。
> 实际：`grep 追问 specs/001-panel/spec.md` **零命中** —— 全篇 44 条 AC 没有一条管"追问"；
> S4 的 `roster` 明确把 host 过滤掉（不传 role，host 进不来）；S6.5 原稿里也没有任何"主持人中场发言"的任务。

三段一起看，结论很直接：**跑起来会是"主持人开场一句 → 专家互喷 20 轮 → 主持人总结一句"**。中间二十分钟主持人消失。那是辩论赛，不是圆桌；F3 的"追问 / 串联"和考察点第 6 条"沉浸感、像在看一场演播厅讨论"直接丢分。

这类缺口最阴的地方在于：**没有任何一条测试会红。** S4 的 9 条全绿、42 条全绿，因为契约里根本没写这件事。

**修正**：

- `spec.md` v1.1 补 **AC-1.25**：每累计 4 条专家发言，主持人产出一条 `speech_type='question'` 的 turn；
  必须引用最近发言里的具体观点并推向最分歧处；≤120 字；计入 `turns`/`turn_no`，**不计入 `expert_turn_count`**，不触发提炼窗口。
- `SESSION_MAP` S6.5 增加 **D 段**：`host/interject.ts`（prompt + 生成），由 runner 每 4 条专家发言调用一次，**不经过 ledger**（ledger 只调度专家）。
- 对应测试：12 条专家发言 → 恰好 3 条 `question` 且发言人必须是 host，且 `expert_turn_count` 不因它增加。

**教训**：**"测试全绿"只证明实现符合契约，不证明契约覆盖了需求。** 这已经是第二次撞上同一类问题 —— S2 是"模块没有 Session 认领"，S4 是"需求没有 AC 兜着"，症状不同、根因一样：**没人做"需求 → 验收标准"的完整性核对**。所以每个 Session 收尾要加一步机械检查：拿 F1–F7 / T1–T4 逐条问"这条现在由哪条 AC 兜着？"—— 没有 AC 的，就是没人做，无论测试多绿。

---

### S5 · 调度决策纯函数

**阶段**：TDD

**核心 Prompt**：SESSION_MAP 的 S5 段原文（TDD：先贴 9 条红）。

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
9. 跨轮状态不外挂：input 里带 prev_stall_count，返回值里带 stall_count；
   同一组输入调用两次必须得到完全相同的结果（含 stall_count）。

第二步：实现 decide()，满足全部 9 条。
硬约束：不得出现 Date.now / Math.random / fetch / 任何 db import / 任何 llm import。
验收：先给 9 条失败的输出，再给全绿的输出。
```

**意图**：把"下一个谁说话"从模型手里收回成一条可测的规则链。模型只负责给建议（`LedgerOutcome`），真正的裁决在 `decide()`：名单空就炸、停摆 3 就停、满足了或到 20 条就收尾、同一个人不许连着说两次。这一层越纯，runner 越好写，回放越好查。

**接口**（SESSION_MAP 未给签名，本轮定死）：

```ts
decide(input: DecideInput): DecideResult

DecideInput = { ledger: LedgerOutcome; roster; transcript; expert_turn_count;
                prev_stall_count; max_expert_turns? }
DecideResult =
  | { action:'speak'; guest_id; speech_type; instruction; stall_count }
  | { action:'summarize'; reason:'request_satisfied' | 'max_turns'; stall_count }
  | { action:'force_stop'; reason:'loop'; stall_count }
```

判定顺序（先命中先返回）：空名单抛 `DecideError('EMPTY_ROSTER')` → `prev_stall_count >= 3` force_stop → `is_request_satisfied` summarize → `expert_turn_count >= 20` summarize → speak。

**实现决定**（需要留档）：

1. **stall 只认一个来源**：S4 的 `computeStallDelta` 已经在更新计数，所以 S5 **不重算**，只把 `prev_stall_count` 原样带回 `stall_count`。runner 必须把本轮的 `ledger.stall_count` 当作 `prev_stall_count` 传进来，否则会丢掉这一轮 +1。
2. **反轮流是硬约束，不靠模型自觉**：只要账本点名的人等于 transcript 最后一位发言人，就换成"最久未发言者"（并排除刚说完的人）。AC-1.21 的"`next_guest_id` 连续两次相同比例为 0"由此单步保证；全场的 speech_type 多样性仍要 runner 跑完才可证。
3. **`speech_type` 兜底**：`LedgerOutcome.speech_type` 类型是整个 `SpeechType` 联合，但专家只能出 4 种短类型，所以 `opening/summary` 一律降成 `supplement`。
4. **最久未发言的规则与 S4 fallback 同构**：没出现过的最优先，其次取上次出现最早的；平手按 roster 顺序。S5 允许改的文件不含 `ledger.ts`，所以这段 10 行选择器在 decide 内本地实现，并在注释里标明同构来源（下一轮若动 ledger，两处要一起改）。

**验收（先红后绿）**：

```
# 第一步：只有骨架（decide() 抛 not implemented）
× 9 条 → Test Files 1 failed / Tests 9 failed

# 第二步：实现后
$ pnpm -C server test -- decide
✓ test/host/decide.test.ts (9 tests) 4ms
Test Files 1 passed / Tests 9 passed

$ pnpm check
tsc --noEmit ×2 ✓ → 7 files / 51 tests passed

$ grep -E "Date\.now|Math\.random|fetch|db|llm" server/src/modules/host/decide.ts
（无输出）
```

**COVERAGE 核对（从本轮起固定动作）**：

- 逐行看「验收标准」列：F1–F7 / T1–T4 全部有 AC，无空行。
- 逐行 `Test-Path` 实现归属，**目录存在不算数，要数文件**：`discussion/`、`sse/`、`summary/`、`turn/`、`web/src/views/` 目前都是 0 文件，所以对应行仍是 ⏳/🟡，没有虚报。
- F3 状态：`🟡 账本 + decide 已完成（单步降级/换人已锁）；runner + 追问待 S6.5`。
- 无新增 AC，无需加行。

**教训**：**"纯函数"的证明不是"函数体里没有 var"，而是"同一个输入两次，输出一个字节都不差"。** 第 9 条测试把 `prev_stall_count` 拉进来，才逼出真正的边界问题：状态到底由谁更新。答案是 S4 更新、S5 原样带回 —— 一旦 S5 自作聪明再算一次，同一个 `is_in_loop` 会被计两次，停摆会提前一轮触发，而所有单测仍然可能是绿的。

**审查补记（独立复核，判定期）**：

9 条测试全绿、纯度 grep 干净、判定顺序与 AC 对得上。但复核出一个**只会在 S6.5 才现形**的漏洞：

> 反轮流用的是 `transcript[transcript.length - 1].guest_id` —— **"最后一条发言"，不是"最后一条专家发言"**。

S5 的测试里 transcript 全由专家发言组成，所以这条永远成立。但 S6.5 一旦按 AC-1.25 每 4 条插一条主持人追问，transcript 的末尾就会是**主持人**（host id 不在 roster 里）。此时 `candidate.id === lastSpeakerId` 永远为假 → 反轮流静默失效 → 同一位专家可以连着说两次 → **AC-1.21（`next_guest_id` 连续相同比例为 0）在库里被违反，而 9 条单测照样全绿**。

修法：倒序扫 transcript，取**第一条 guest_id ∈ roster** 的发言作为"上一发言人"。补一条回归测试：`transcript = [专家乙, 主持人追问]`、账本仍点名专家乙 → 必须换成专家甲。

**这是本轮的第二次同类发现**：S4 是"需求没有 AC"，S5 是"约束依赖了一个未来才成立的前提"。共同点是 —— **它们都不是当前代码的错，而是"当前代码在下一阶段的输入下会错"**。所以从 S5 起，收尾多问一句：*这个实现有没有依赖"当前 transcript / 当前名单形态"的假设？下一阶段会不会打破它？*

---

### S6 · SSE 事件总线 + 嘉宾确认

**阶段**：TDD

**核心 Prompt**：

```
已读 AGENTS.md。本次执行 S6：SSE 事件总线。允许改：
server/src/modules/sse/**, server/src/modules/guest/confirm.ts, server/test/sse/**
输入：specs/001-panel/contracts/events.md

1. bus.ts：Map<discussion_id, Set<subscriber>>，publish / subscribe。
2. 事件先写 events（discussion_id + seq 自增）再推给同 discussion 的订阅者。
3. Last-Event-ID 只补 seq > k，补完发 event: caught_up。
4. 响应头 text/event-stream + no-cache, no-transform + X-Accel-Buffering: no。
5. 心跳 15s，": ping"，不写 id。
6. close/error 清理 interval + Set 移除，interval unref。
7. 无订阅不得中止讨论。
8. publishEphemeral 只允许 turn.delta，其他抛错。
9. confirm 单事务：行数校验 → locked=1 → 逐人 agent_status(idle) →
   逐人 agent.status 事件（updated_seq = 该事件 seq，不许 0）→ state.ready。
   行数不符 409 GUEST_COUNT_MISMATCH。
```

**意图**：把"事件落库"和"实时推送"合并成唯一入口，同时守住两条容易在下一轮被破坏的边界：`turn.delta` 不落库、推送必须发生在 COMMIT 之后。confirm 是 S8 订阅初始状态的来源，`updated_seq = 0` 会让专家小窗从第一帧起就是空的。

**卡点 / 实现决定**：

1. **delta 污染 seq 是主动拦的，不是靠记性**：`publish()` 对 `turn.delta` 直接抛 `TURN_DELTA_NOT_PERSISTED`，只有 `publishEphemeral()` 能发它；后者白名单写死 `turn.delta`。两向都加了测试，后面 S6.5 想"顺手接上"会立刻红。
2. **confirm 与总线共用写点**：`appendEventInTx` 在调用方事务里取号 + 插入，confirm 在一个事务内写 5 条 agent.status + 1 条 state.ready；`EventBus.publish` 自己包事务。提交后才 `broadcast`，避免"推了但回滚"。
3. **补发与实时注册的顺序**：查询 `seq > k`、写回放帧、写 caught_up、加入 Set 全部同步完成（better-sqlite3 同步 + 单线程），中间没有 await，因此不存在回放与实时推交叉的窗口。`caught_up.up_to_seq` 取订阅时刻的 `last_event_seq`，而不是回放最后一条。
4. **清理**：`close` / `error` / `write` 抛错三条路径都进同一个幂等 `cleanup`；interval 先 clear 再删 Set；空 Set 连带删 Map 键。心跳定时器 `unref()`。
5. **路由 404 在开流前判定**：未知讨论返回 JSON `DISCUSSION_NOT_FOUND`，不写 SSE 头（AC-3.6）；之后 `reply.hijack()` 交给 `reply.raw`。

**验收**：

```
$ pnpm -C server test -- sse
✓ test/sse/confirm.test.ts    (4 tests)
✓ test/sse/sse-http.test.ts   (2 tests)
✓ test/sse/bus.test.ts        (12 tests)
Test Files  3 passed / Tests 19 passed

$ pnpm check
tsc --noEmit ×2 ✓ → 10 files / 71 tests passed（S5 结束时 52 条）
```

**五条盯梢逐条对应**：

| 要求 | 落点 / 测试 |
|---|---|
| 每位嘉宾一条 agent.status，updated_seq = 事件 seq ≠ 0 | `confirmGuests` 逐人 append 后 upsert；`confirm.test.ts` 断言 5 行 `updated_seq > 0` 且逐行等于对应 `agent.status.seq` |
| 按 discussion_id 隔离 | `EventBus.subscribers` 的 Map 键；bus 单测 + `sse-http.test.ts` 两个真实 fetch 流并发，断言互不出现对方 payload |
| Last-Event-ID exclusive | SQL `seq > ?`；k=3 只收到 4,5，`id: 3` 不出现；k=0 全量、k≥last 只发 caught_up |
| publishEphemeral 白名单 | 非 `turn.delta` 抛 `EPHEMERAL_TYPE_NOT_ALLOWED`；`turn.done` 用例断言不写表、不推帧 |
| `: ping` 无 id、close 清定时器 | 20ms 心跳测试：先累计 ≥2 次 ping，close 后计数不再增长且 Set 归零 |
| 额外：delta 不许走 publish | `TURN_DELTA_NOT_PERSISTED`，events 行数与 `last_event_seq` 均为 0 |

**COVERAGE 核对**：F2（generate + confirm）→ ✅；T2（多讨论隔离）→ ✅；T3 服务端完成、S8 `api/events.ts` 仍待做 → 🟡。`sse/` 不再是空目录。

**范围说明**：为注册两条新路由，只改了 `server/src/app.ts`（13 行，构造/注入总线 + register），属于接线必需，未触碰其他模块；另在 `.gitignore` 增加 `server/test/data/`，防止测试库残留被误提交。

**审查补记（Oracle 独立复核，已修）**：

五条底线（逐人 `updated_seq=seq`、讨论隔离、补发 exclusive、ephemeral 白名单、心跳清理）全部通过，confirm 事务与 409 无副作用也确认无误。但复核抓出两个真问题，都已带回归测试修掉：

1. **`publish()` 在调用方事务里会"先推送后提交"（已修）**：better-sqlite3 的嵌套事务只是 SAVEPOINT，`append.immediate()` 并不真正 COMMIT，`broadcast()` 就提前把帧推出去了。外层回滚后 `seq` 被复用 → 客户端拿着 `Last-Event-ID: 1` 永远收不到真正的 seq 1，去重也会误杀。这正是 events.md 明令禁止的"已推送未落库"，而 S6.5 runner 的"一笔发言"必然要把 `turn.started` + `turns` + `turn.done` 包在一个事务里，**不修就必踩**。
   修法：`publish()` 检测 `db.inTransaction`，直接抛 `PUBLISH_INSIDE_TRANSACTION`，强制调用方走 confirm 的模式（`appendEventInTx` 在事务内、提交后 `broadcast`）。回归测试：事务内 publish → 抛错、events 0 行、`last_event_seq` 仍为 0、订阅者无新帧。
2. **有 SSE 连接时 `app.close()` 永不返回（已修）**：`SseSink` 只有 `write`/`on`，`closeAll()` 清定时器和 Map 但**不结束响应**，`server.close()` 会一直等活连接；叠加 `onClose` 在 avvio 里 LIFO（Fastify 的 `server.close` 先跑），直播中按 Ctrl+C 直接把进程挂住。
   修法：`SseSink` 增加可选 `end()`，`closeAll()` 先 end 再清理；钩子从 `onClose` 改为 **`preClose`**（在 `server.close` 之前执行）。回归测试：真实 HTTP 流保持连接时 `app.close()` 2s 内必须 resolve、流收到 EOF、订阅集合归零。

顺带补的（Oracle 合同偏差清单里低成本的几条）：

- `publish()` 增加**类型值校验**：`state.*` 的 `status` 必须等于 type 后缀；`consensus/divergence.added` 只能 `provisional`，`.updated` 只能 `final|dropped`。共享 schema 只按族校验，这一层补上单写点的最后防线。
- confirm 除了行数，还断言**恰好 1 位 host + `expert_count` 位 expert**（`uq_guests_one_host` 只挡 >1，不挡 0）。
- SSE 路由 `subscribe()` 包 try/catch：头部已发出后若抛错（如关库中途）主动 `raw.end()`，避免留一个永远空的 200 流。
- `parseFrames` 从 `src/` 挪到 `test/sse/helpers.ts`，不把测试代码打进生产。
- 在 `subscribe()` 写明"全同步、中间不得出现 await"的注释，防止未来有人加 await 打穿补发与实时注册的原子性。

仍留作后续（本轮不改，已在 §0 记录风险）：data-model §4.3 的 `SQLITE_CONSTRAINT` 三次重试 + 置 `failed` 未实现（单进程计数器下不可达，且置 failed 属 S6.5 runner 的 `run.failed` 语义）；慢客户端的背压（`write()` 返回 false）暂不处理；`events.payload` 的上限实现为 4096 **字节**，比 DB/共享 schema 的 4096 **字符**更严。

**审查补记（独立复核，判定期）**：

五条底线 + delta 污染防线逐条对上，19 条 sse 测试都是真断言。最亮的一处不是"先提交后推送"这个结论，而是它的**实现方式**：`publish()` 直接检测 `db.inTransaction` 并抛 `PUBLISH_INSIDE_TRANSACTION`，逼调用方改用 `appendEventInTx` + 提交后 `broadcast`。这比"我承诺按顺序写"强一个量级 —— 顺序靠代码结构保证，不靠人记得。

修了两处契约偏差：

1. **SSE 响应头无条件带 `Connection: keep-alive`**。HTTP/1.1 没问题，但 `Connection` 是 hop-by-hop 头，**HTTP/2 明令禁止**（RFC 9113 §8.2.2）。本地 demo 不会碰到，可一旦有人用 h2 终止代理，整条流会被判协议错误。改成按 `request.raw.httpVersionMajor` 判断：只有 1.x 才加。
2. **`confirm` 对"0 行嘉宾"返回 `INVALID_STATE_TRANSITION`**，而 AC-1.7b 写的是"`guests` 行数 ≠ `expert_count + 1` → 409 `GUEST_COUNT_MISMATCH`"。0 行显然也是行数不符。虽然两者都是 409、测试也不红，但错误码是前端分支依据 —— 错一个码就是错一个 UI 分支。统一到 `GUEST_COUNT_MISMATCH`，消息区分"尚无阵容"和"数量不匹配"。

**教训**：**契约里的边界值要按字面量核对，别按语义直觉。** "0 行"在实现者眼里是"还没准备"，在契约里是"数量不符"。这类偏差永远测试不红（状态码一样），但会在前端表现成一个错误的提示、一条走错的分支。以后写 AC 时，把边界值（0、1、上限、刚好等于）单独列出来，比写"不匹配"这种概括词更省事。

---

## S6.5 · 讨论生命周期 + 主循环（2026-11-17）

**提示词（摘要）**：按 `docs/SESSION_MAP.md` S6.5 执行，允许改 `modules/discussion/**`、`turn/runner.ts`、`summary/extract.ts`、`host/interject.ts`、`test/discussion/**`、`test/runner/**`。A 五个 REST 端点；B 开场→循环→收尾；C 每 2 条提炼；D 每 4 条主持人追问。验收：`pnpm -C server test -- runner` 全绿 + 真实 HTTP 跑完一整场。

**意图**：把 S4/S5 的"单步决策"接成一条真正会推进的讨论，同时守住三条最容易在下一轮被破坏的边界：`publish()` 不进事务、stall 必须逐轮串联、主持人 turn 必须进 transcript 但不能算专家发言。

**实现决定**：

1. **状态唯一写点**：`discussion/status.ts` 的 `transitionInTx` 同时改行 + 追加 `state.*`，非法迁移直接抛 `INVALID_STATE_TRANSITION`。REST 读状态也走 `loadDiscussionStatus`，满足 H8。
2. **一笔发言 = 两个事务单元**：`turn.started + agent_status(preparing)` 在调模型前提交；`turns + speaking + turn.done + idle` 在模型返回后提交。两次都只 `appendEventInTx`，提交后 `broadcast`，**没有任何 `publish()` 调用**（runner / extract 里 grep 只剩注释）。
3. **stall 串联**：`requestLedger` 收 `prevStall`；`decide` 收 `outcome.stall_count`；下一轮 `prevStall = outcome.stall_count`。第三轮 ledger 返回 3 → 同轮 `force_stop`，`run.finished.reason='stalled'`，专家发言停在 2 条。
4. **追问不污染计数**：专家数用 `turns JOIN guests role='expert'` 统计；host question 只增 `turn_no`，不增 `expert_turn_count`，也不进提炼窗口。12 条专家 → 恰好 3 条 question，guest 全是 host。
5. **提炼**：每次窗口只看最近 4 条发言；`INSERT ... ON CONFLICT DO NOTHING` 靠 `uq_*_text` 去重；先 insert 点、再 append 事件、再把 `updated_seq` 回填为事件 seq。模型输出不合法返回空数组（跳过窗口，不阻塞调度）。
6. **取消**：`cancel` 先提交 `cancelled + run.cancelled`（`error_code` 恒 NULL），再 abort；runner 每次写之前看 signal，写事务里再看 `status='running'`。测试在 runner 进行中取消，turns 计数冻结、无 `state.finished`。
7. **start 的 500**：按 openapi 补了"无注入 client 且 key 缺失 → 500 `LLM_NOT_CONFIGURED`"的前置判断，避免先置 running 再异步失败。

**验收（测试）**：

```
$ pnpm -C server test -- runner
✓ test/runner/runner.test.ts (8 tests)
$ pnpm -C server test -- discussion
✓ test/discussion/lifecycle.test.ts (9 tests)
$ pnpm check
Test Files  12 passed / Tests  89 passed      （S6 结束时 71 条）
tsc --noEmit ×2 ✓
```

**验收（真实 HTTP，#11，expert_count=2）**：

```
POST /api/discussions        -> 201 draft, last_event_seq=1
POST /guests/generate        -> 1 host + 2 experts, locked=false
POST /guests/confirm         -> ready, 3 guests
POST /start                  -> 200 running, started_at=11:54:08.735Z
（约 56s 后）
GET  /api/discussions/11     -> status=finished, last_event_seq=72, summary_len=231
                                 summary_text 与 speech_type='summary' 的 turn 逐字相同
turns=10：opening 1 / challenge 3 / rebuttal 4 / question 1 / summary 1
专家发言 7 条，主持人追问 1 条（turn_no=6），专家顺序 57,58,57,58,57,58,57（无连续同一人）
ledger=8 行：7 speak + 1 summarize，stall 全 0；其中 1 次模型输出不合法 → is_retry=1 后成功
llm_calls：guest 1 / ledger 9 / turn 9 / summary 4（提炼 3 窗口 + 收尾 1）
events：consensus.added 7、divergence.added 6、turn.done 10、agent.status 33
```

**六条盯梢逐条对应**：

| 要求 | 落点 / 证据 |
|---|---|
| publish() 不进事务，用 appendEventInTx + 提交后 broadcast | `runner.ts` 的 `commitAndBroadcast`；grep 新代码无 `publish(` 调用；取消测试中途写入不炸 |
| stall 本轮值 → 下轮 prev，传旧值只有专门测试会红 | `runner.test.ts` stall 用例：ledger 3 行、stall 1/2/3、第 3 行 `force_stop` |
| decide transcript 含主持人 turn，换人只看最后一条专家 | `ledger` prompt 断言含开场白/追问；12 条用例断言专家序列无相邻重复 |
| 每 4 条专家插 host question，不计 expert_turn_count | 12 条用例：3 条 question + `run.finished.expert_turn_count=12` |
| confirm 之后才能 start；running 超 3 场 409 | draft start → 409 `INVALID_STATE_TRANSITION`；3 running 后 → 409 `TOO_MANY_RUNNING` |
| llm_calls 断言 `turn` 与 `summary`（不只 guest） | 完整场用例按 module 分组断言 ledger/turn/summary 均 > 0；真调同样三类都有 |

**COVERAGE 核对**：F1 → 🟡（REST 完成，S7 页面待做）；F3 → ✅（服务端闭环）；F4 → 🟡（runner 写 `agent_status`，S8 渲染）；F5 → 🟡（extract 完成，S9 归并）；F7 → 🟡（summary 已产，S9 归并 / S8 渲染）。

**遗留 / 边界说明**：

1. `guests/generate` 仍未发 `state.generating` / `state.draft`。§0 原本写"S6.5 接线时补"，但 S6.5 的允许改清单不含该文件，按纪律**没动**，需要单独裁决（补一个小 Session 或并入 S8）。
2. 单条发言失败会让 `turns.turn_no` 留空洞（`turn.started` 已取号、`turns` 未插入）。唯一索引允许，正常路径不触发；`ledger.turn_no` 已改成独立单调序号（`MAX(turns, ledger)+1`），连续失败不会撞 `uq_ledger_turn`。若要求 `turns.turn_no` 严格连号，需要在失败时补写占位行或改成"定稿时才取号"（后者与 `turn.started` 的契约冲突）。
3. summary 只硬保证 ≤400 与失败兜底文案；150–250 字目前靠 prompt。真调这次是 231 字，符合，但没有代码层校验。
4. 提炼的 `support_guest_ids` 暂写空数组：SESSION_MAP 的 `extractPoints` 返回 `string[]`，没给支持者映射；前端要"谁同意"需 S9 再补。

**Oracle 独立复核（已修）**：

复核确认六条底线全部成立，但抓出一处会把整场讨论误判为 `failed` 的链路，以及三个契约偏差：

1. **（major，已修）连续两次发言失败会撞 `uq_ledger_turn`**：`recordLedger` 原用 `MAX(turns.turn_no)`，失败时不产生 `turns` 行，下一次决策算出同一个号 → `SQLITE_CONSTRAINT` 逃出主循环 → 整场 `failed`，而 spec §4.3 要求单条失败只降级。改成 `Math.max(MAX(turns), MAX(ledger)+1)`，并加"前两次专家发言都失败、随后恢复"的用例（3 位专家，避免同时触发 AC-1.16）。
2. **（已修）start 的 500 抢在 404/409 前面**：key 缺失时，不存在的 id 会返回 500 而不是 404，非 ready 会返回 500 而不是 409。路由改为先做只读 preflight（404 / 409），再判 `isLlmConfigured()`；新增"无 key 时 404/409 优先、ready 才 500"的测试。
3. **（已修）`agent.status.focus` 恒为 null**：AC-1.20 要 ≤80 字公开关注点，F4 小窗没东西可渲染。专家发言用 `decision.instruction` 截 80 字填入，追问/总结用固定短语。
4. **（已修）running 但阵容缺失会永久占位**：`loadRunnerState` 返回 null 时原来直接 `skipped`，行停在 `running`，永久吃掉 3 场并发额度之一。现在只要行仍是 `running` 就置 `failed`。

另补三条失败路径测试（AC-1.15 空 transcript、AC-1.16 全部专家失败、§4.3 总结失败兜底），全仓从 84 → **89** 条。

**未改的一条**：非 `LlmError` 的内部异常仍落 `LLM_UPSTREAM_ERROR`。`error_code` 是封闭三值枚举（DB CHECK 只有 `LLM_NOT_CONFIGURED / LLM_UPSTREAM_ERROR / ALL_SPEAKERS_FAILED`），没有 `INTERNAL` 可表达；改成 `ALL_SPEAKERS_FAILED` 同样误导用户，故保留现状并在日志里大声打 `[runner]`。

**审查补记（独立真跑，判定期）**：

我没有只看报告，自己起了一个真实端口跑了一整场（2 位专家、真实 DeepSeek），并全程挂着 SSE 收帧：

```
create 201 → generate 200(3 guests) → confirm 200(ready) → start 200
SSE: 200 text/event-stream，id 存在，caught_up 到达
frames: agent.status 74 / turn.started 24 / turn.done 23 / consensus.added 22
        divergence.added 15 / state.draft|ready|running 各 1 / run.started 1
turns 23 条：turn 6、11、16、21 是主持人追问 → 节奏精确（每 4 条专家发言一次）
专家 A/B 严格交替（60,61,60,61…），主持人插话没有打断换人规则
llm_calls: guest 1 / ledger 23(4 次重试) / turn 24 / summary 9 —— 四类都真实落行
```

**三个只有真跑才会露出来的事实**：

1. **时长是 1–3 分钟，不是 56 秒。** 我这场跑到 150s 时已有 18 条专家发言、仍未收敛。他报的 56s 是"8 条发言就 `is_request_satisfied`"的幸运局。真实分布取决于模型何时觉得"够了"。→ E2E 必须走 fake；若有人把真调写进用例，超时至少 180s（已写进 S10）。
2. **`turn.started` 比 `turn.done` 多 1 条。** 一次 `empty speech` 失败后重试，而 `turn_no` 取 `MAX(turns)+1`、失败没落行，于是**同一个 turn_no 发了两条 start、只有一条 done**。他遗留里写的"turn_no 会留空洞"正好说反了 —— 不是空洞，是**重号**。已把这条写进 `events.md` §8.1（服务端观测口径 + 客户端必须按 `(guest_id, turn_no)` 幂等、transcript 只认 `turn.done`），并同步进 S8。
3. **`ledger` 的 JSON 有 4/23 解析失败（invalid_json），重试后全部成功。** 也就是说 `parse_status='json_mode'` 在真实环境里约占 17%，不是理论分支。降级链确实在工作，但"只输出纯 JSON"这条 prompt 约束不够硬（大概率是字符串里带了裸换行）。→ 记入质量待办；S9 收口时应顺手加一次 parse 容错。

**四处遗留的裁决**：

| 遗留 | 裁决 |
|---|---|
| `generate` 不发 `state.generating` / `state.draft` | **不加**。没有观察者会盯着一个 draft 场；造一条没有真实状态迁移的 `generating` 事件，等于让事件流说谎。已在 `events.md` §5 把该 type 标为"当前不发送，保留备用"，AC-3.2 的 `generating` 分支随之是死分支，可接受 |
| `turn_no` 空洞 | 见上：实为**重号**，不是空洞。已写成契约 + 客户端幂等要求，不改代码 |
| `summary` 150–250 只靠 prompt | **S9 硬校验**（已写进 S9 prompt：超范围重试一次，仍不合法则夹到边界并记 `success=0`） |
| `support_guest_ids` 空数组 | **S9 必须补**（已写进 S9 prompt：姓名映射回 `guests.id`，映射不到就丢弃，归并时保留） |

**教训**：**"测试通过"和"演示通过"是两件事。** 单测里每轮都是 100% 成功、0ms；真跑里每轮 3–7s、17% 概率输出不合法、一场 1–3 分钟。这轮所有真问题（时长、重号、解析失败率）单测都复现不了 —— 它们不存在于"逻辑是否正确"，只存在于"在真实概率分布下会发生什么"。所以每完成一个能跑起来的 Session，必须真跑一次，并把观测数字写下来；数字比"跑通了"值钱。





