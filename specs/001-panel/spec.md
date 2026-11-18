# spec.md — AI Panel Studio 行为与验收契约

> 阶段：S0 契约冻结（SDD）
> 输入：`docs/REQUIREMENTS.md`（真相源最高优先级）
> 配套：`specs/001-panel/data-model.md`（表结构与不变量）、`docs/SESSION_MAP.md`（会话边界）、根 `AGENTS.md`（工程约束）
> 状态：**已冻结 v1.0**（S0 裁决完成，见 §7；此后任何改动走 `AGENTS.md` §7 的 Ask first）

---

## 1. 目的与范围

本文件只定义**可观测行为**与**验收标准**，不定义实现方式。

- 在范围内：一场讨论从「输入话题」到「自然语言总结 + 共识 / 分歧清单」的完整闭环；多讨论并行隔离；首页列表与加入观察；响应式演播厅。
- 不在范围内：登录 / 权限 / 计费 / 移动 App / RAG / TTS / 导出 / 分享链接（完整清单见根 `AGENTS.md` §2）。

**本文件与 `data-model.md` 冲突时：停止，输出冲突点，等人裁决。**（`AGENTS.md` §3）

---

## 2. 术语（全文口径唯一）

| 术语 | 定义 |
|---|---|
| 讨论 discussion | 一次圆桌，一条 `discussions` 行；`id` 为整数主键 |
| 嘉宾 guest | 主持人或专家，一条 `guests` 行；`role ∈ {host, expert}` |
| 发言 turn | 一条已经定稿的发言，一行 `turns`；主持人开场 / 收尾总结也是 turn |
| 事件 event | 一行 `events`，带 `(discussion_id, seq)`；SSE 推送的原子单位 |
| 序号 seq | **讨论内**事件序号，从 1 开始单调递增，跨讨论互不共享 |
| 发言序号 turn_no | **讨论内**发言序号，从 1 开始单调递增，与 `events.seq` 是两套编号 |
| 提炼窗口 | 每 2 条专家发言构成一次共识 / 分歧提炼的触发单位 |
| 发起者 / 观察者 | 客户端自带的匿名 `sessionId` 区分；v1 **后端不做权限校验**，两者后端能力相同；但前端按 `session_id` 比对隐藏写操作入口（AC-3.8） |
| 停摆计数 | 账本判定「在原地打转」的连续次数，达到 3 触发强制收尾 |

**牌面数字约定**：专家人数 `expert_count ∈ [1, 8]`，默认 4（故一场最多 1 主持 + 8 专家 = 9 行 `guests`，**色板必须 ≥ 9 色**）；单条专家发言 ≤ 120 字（约 1–2 句）；主持人开场 / 总结 ≤ 400 字；总结正文 150–250 字；SSE 心跳 15s；专家发言上限 20 条；**每 4 条专家发言插入 1 次主持人追问（≤120 字）**；同时 `running` 的讨论 ≤ 3 场。

---

## 3. 用户故事与独立验收标准

验收标准一律 EARS 三选一，必须含 `SHALL`，响应必须可观测（HTTP 状态码 / 落库行数 / DOM 断言 / 计时 / 事件条数）。
禁用表述：正常工作、符合预期、友好提示、尽量、合理、适当。

### US-1（P1）跑通一场完整讨论

作为用户，我输入话题与专家人数，得到一支嘉宾阵容，确认后看完整场讨论，最后拿到自然语言总结与共识 / 分歧清单。

**独立验收标准**

- AC-1.1 WHEN 用户提交 `topic`（1–200 字）与 `expert_count ∈ [1,8]` THEN THE SYSTEM SHALL 在 1s 内创建 `status='draft'` 的讨论并返回其整数 `id`。
- AC-1.2 IF `topic` 为空或超 200 字，或 `expert_count` 越界 THEN THE SYSTEM SHALL 返回 400，且 `discussions` 表行数不变。
- AC-1.3 WHEN 用户请求为 `draft` 讨论生成嘉宾 THEN THE SYSTEM SHALL 在 30s 内返回 1 位 `role='host'` 与 `expert_count` 位 `role='expert'`，每人均含非空 `name / profession / stance / color_id`，同一讨论内 `color_id` 两两不同，且**全部以 `locked=0` 落库**。
- AC-1.4 WHEN 用户对尚未确认的讨论**再次**请求生成嘉宾 THEN THE SYSTEM SHALL 先删除该讨论全部 `locked=0` 的 `guests` 行（及其 `agent_status` 行）再写入新阵容；IF 该讨论已存在 `locked=1` 的嘉宾 THEN THE SYSTEM SHALL 返回 409 且 `guests` 行数不变（已确认的阵容不可覆盖）。
- AC-1.5 IF 模型输出经 zod 二次校验仍不合法（缺字段 / 人数不符 / 色板外 / 颜色重复） THEN THE SYSTEM SHALL 重试 1 次；仍不合法则返回 422，且 `guests` 表该讨论的行数与调用前一致（不得留下半套阵容）。
- AC-1.6 IF `process.env.DEEPSEEK_API_KEY` 缺失 THEN THE SYSTEM SHALL 返回 500 且 `error.code='LLM_NOT_CONFIGURED'`，不得返回任何伪造嘉宾。
- AC-1.7 WHEN 用户确认阵容 THEN THE SYSTEM SHALL 在 1 个事务内：把该讨论全部 `guests.locked` 置 1、为每位嘉宾建一行 `agent_status(state='idle')`、**为每位嘉宾写入一条 `agent.status` 事件**（`updated_seq` 取该事件 seq，不得留 0）、把 `discussions.status` 置 `ready`。
- AC-1.7b IF 该讨论 `guests` 行数 ≠ `expert_count + 1` THEN THE SYSTEM SHALL 拒绝确认并返回 409 `GUEST_COUNT_MISMATCH`。
- AC-1.8 WHEN 用户对 `ready` 讨论发起开始 THEN THE SYSTEM SHALL 在 5s 内落库并推送 `run.started`，随后产出主持人开场 turn（`speech_type='opening'`）。
- AC-1.9 WHILE 讨论处于 `running` THE SYSTEM SHALL 每次发言定稿时**同时**写入 `turns` 一行并推送 `turn.done`；`turn.delta` 只承载流式片段，不写库、**不带 `id`**、不参与 `seq` 去重与补发。断线期间的 delta 永久丢失，由重连后 `turn.done` 的 `content` 整体覆盖临时缓冲。
- AC-1.10 IF 单条专家发言（`challenge / supplement / rebuttal / question`）超过 120 字 THEN THE SYSTEM SHALL 在最后一个句末标点处截断至 ≤120 字后入库，不重试。主持人 `opening / summary` 不受 120 字限制（上限 400 字），不截断。
- AC-1.11 IF 账本点名的 `next_speaker` 不在 `locked=1` 的嘉宾名单内 THEN THE SYSTEM SHALL 在 1 次重试后降级为「最久未发言的专家」，并把该轮 `ledger.parse_status='fallback'`。
- AC-1.12 WHEN 停摆计数达到 3 THEN THE SYSTEM SHALL 停止调度并进入总结阶段，不再产生新的专家 turn。
- AC-1.13 WHEN 专家发言条数达到 20、或账本判定 `is_request_satisfied=true`、或停摆计数达到 3 THEN THE SYSTEM SHALL 由主持人产出一条 `speech_type='summary'` 的 turn，并把 `status` 置 `finished`。
- AC-1.14 WHEN 讨论进入 `finished` THEN THE SYSTEM SHALL 返回一段 150–250 字中文**纯文本**总结（非 JSON、不逐条罗列、至少点出一处主要分歧），写入 `discussions.summary_text`。
- AC-1.15 IF `turns` 表该讨论为 0 行 THEN THE SYSTEM SHALL 写入固定文案「本场讨论未产生有效发言」并以 `finished` 收尾。
- AC-1.16 IF 全部专家调用均失败 THEN THE SYSTEM SHALL 把 `status` 置 `failed`、推送 `run.failed`，并在 `discussions.error_code` 写入失败原因码。
- AC-1.17 WHEN 任一面板渲染 THEN THE SYSTEM SHALL 使页面可见文本中不出现原始 JSON 片段（`"reason":`、`"type":"`、`{"` 开头的对象字面量）、`ledger` 表内容、chain-of-thought。
- AC-1.18 WHILE 讨论处于 `running` THE SYSTEM SHALL 每完成 2 条专家发言触发一次共识 / 分歧提炼，把新增项以 `status='provisional'` 写入并推送 `consensus.*` / `divergence.*` 事件（**不需要等到讨论结束**）；且每条新增事件的 `seq` 必须大于触发它的那条 `turn.done` 的 `seq`，`updated_seq` 取自该事件（不写"同一秒内"这类墙钟断言，避免 E2E 抖动）。
- AC-1.19 WHEN 讨论收尾 THEN THE SYSTEM SHALL 对 `status='provisional'` 的条目做一次归并：保留项置 `final`，被推翻项置 `dropped`，并更新其 `updated_seq`。
- AC-1.20 WHEN 专家状态变化 THEN THE SYSTEM SHALL 在 `agent_status` 更新 `state`（`idle → preparing → speaking → idle`）与 `focus`（≤80 字公开关注点），并推送 `agent.*` 事件；`focus` 不得包含推理原文。
- AC-1.21 **（对应 F3 核心考点 · 反机械轮流）** WHEN 一场讨论产生 ≥ 12 条专家发言 THEN THE SYSTEM SHALL 使这些发言的 `speech_type` 去重后种类数 ≥ 3，且**不得出现 `speech_type` 全为同一值**的场次；同时 `ledger.decision='speak'` 的行中，`next_guest_id` 连续两次相同的比例必须为 0（除 `parse_status='fallback'` 的降级行外）。
- AC-1.22 **（对应 F6 · 色块一致）** WHEN transcript 渲染单条发言 THEN THE SYSTEM SHALL 使该条的色块取自 `guests.color_id`，且同一嘉宾全场颜色不变、不同嘉宾颜色互不相同。
- AC-1.23 **（对应 F6 · 内部事件不外泄）** THE SYSTEM SHALL NOT 在 transcript 区渲染任何 `agent.*` / `run.*` / `state.*` 事件；transcript 区只渲染 `turn.done` 对应的 `turns` 行，`turn.delta` 期间的临时内容不得进位为永久条目。
- AC-1.24 WHEN 讨论处于 `ready` 且用户取消 THEN THE SYSTEM SHALL 把 `status` 置 `cancelled`、`finished_at` 写入当前时间、推送 `run.cancelled`，并**不再产生任何 `turn`**；`cancelled` 与 `failed` 不得混用（`cancelled` 的 `error_code` 恒为 NULL）。
- AC-1.25 **（对应 F3 · 主持人追问 / 串联）** WHILE 讨论处于 `running` THEN THE SYSTEM SHALL 每累计 **4 条专家发言**由**主持人**（`guests.role='host'`）产出 1 条 `speech_type='question'` 的 turn：内容必须引用最近发言里的**具体观点**并指向其中最分歧或最未展开的一点，长度 ≤120 字；该 turn 计入 `turns` 与 `turn_no`，但**不计入 `expert_turn_count`**，也不单独触发提炼窗口。
  （没有这一条，主持人只会在开场和结尾出现，中间全是专家互喷 —— 那是辩论赛，不是圆桌。）

### US-2（P2）多讨论并行互不干扰

作为用户，我同时开两场讨论，两边的状态、事件流、transcript、共识 / 分歧互不串。

**独立验收标准**

- AC-2.1 WHEN 两个讨论同时 `running` THEN THE SYSTEM SHALL 各自的 `events.seq` 均从 1 开始独立单调递增，且任一讨论的 `seq` 不因另一讨论的写入而跳号。
- AC-2.2 IF 订阅者只订阅讨论 A THEN THE SYSTEM SHALL 向其推送的 B 讨论事件条数为 0。
- AC-2.3 WHEN 订阅请求携带 `Last-Event-ID=k` THEN THE SYSTEM SHALL 只补发该讨论 `seq > k` 的事件（strictly exclusive），补发完成后发送一次 `event: caught_up`。
- AC-2.4 IF 同一 `(discussion_id, seq)` 被并发写入 THEN THE SYSTEM SHALL 由唯一索引拒绝该写入，重试后该讨论的 `seq` 集合无空洞、无重复。
- AC-2.5 WHEN 讨论 A 的全部订阅者断开 THEN THE SYSTEM SHALL 保持 A 的 `status` 与调度不变（不取消、不暂停），并在任意新订阅者接入时按 AC-2.3 补齐。
- AC-2.6 WHILE 存在活跃订阅 THEN THE SYSTEM SHALL 每 15s 发送一帧内容为 `: ping` 且不带 `id` 字段的心跳，心跳不推进 `seq`。
- AC-2.7 WHEN 订阅连接关闭或报错 THEN THE SYSTEM SHALL 在 1s 内清除该连接的定时器并从订阅集合移除，集合大小归零。
- AC-2.8 IF 两个讨论的嘉宾同名 THEN THE SYSTEM SHALL 只影响各自的 `guests` 行（唯一约束的作用域是 `discussion_id` 内），不得跨讨论复用。
- AC-2.9 WHEN 前端处理事件 THEN THE SYSTEM SHALL 以 `seq` 为依据去重与排序（收到 `seq ≤` 已处理最大值的事件即丢弃），不以到达顺序推断业务顺序。
- AC-2.10 IF 当前 `status='running'` 的讨论已达 3 场 THEN THE SYSTEM SHALL 拒绝新的 `start` 请求并返回 409 `TOO_MANY_RUNNING`，被拒讨论 `status` 保持不变（这是 10 元额度预算的硬闸）。

### US-3（P3）首页列表与加入观察

作为用户，我在首页看到所有讨论，能加入观察一场正在进行的讨论，也能发起新的。

**独立验收标准**

- AC-3.1 WHEN 用户打开首页 THEN THE SYSTEM SHALL 在 2s 内返回全部讨论，按 `updated_at` 倒序，每行至少含 `id / topic / status / expert_count / updated_at`。自 S8 起列表行还额外携带 `guest_count`（含主持人的嘉宾行数）、`expert_color_ids`（已确认专家按 `speaking_order ASC, id ASC` 的 `color_id` 数组，未确认为空数组）与 `summary_text`（可为 `null`）；这些字段为 additive 扩展，不改变上述既有字段语义。
- AC-3.2 WHEN 列表渲染 THEN THE SYSTEM SHALL 先渲染「进行中」分组（`draft / generating / ready / running`，带「加入」入口），再渲染「已结束」分组（`finished / failed / cancelled`，只读入口）；接口支持 `?active=1` 只返回进行中。
- AC-3.3 WHEN 用户点击加入观察 THEN THE SYSTEM SHALL 以只读方式进入演播厅：不触发 `guests/generate`、`start`、`cancel` 中的任何一个。
- AC-3.4 WHILE 观察一个 `running` 讨论 THEN THE SYSTEM SHALL 使观察者与发起者读到同一份 `events` 表、同一 `seq` 序列，两者 transcript 条数与内容一致。
- AC-3.5 WHEN 列表包含 `sample=1` 的讨论 THEN THE SYSTEM SHALL 使其可被观察、可重放事件，且与 `sample=0` 的讨论行为一致（同一套接口，无分支）。
- AC-3.6 IF 讨论 `id` 不存在 THEN THE SYSTEM SHALL 返回 404，且不建立 SSE 连接（前端不重连）。
- AC-3.7 WHEN 视口为 1440×900、1280×800、390×844 三档 THEN THE SYSTEM SHALL 满足 `document.scrollingElement.scrollHeight === window.innerHeight`，且 roster / transcript / insights 三个面板各自 `overflow-y:auto` 独立滚动。
- AC-3.8 IF 当前客户端 `sessionId` ≠ 该讨论的 `discussions.session_id` THEN THE SYSTEM SHALL 在 UI 上隐藏「生成嘉宾 / 确认 / 开始 / 取消」四个写操作入口，且点击隐藏按钮不得发起任何请求；后端不因该差异拒绝请求（v1 无鉴权，见 `AGENTS.md` §2）。

---

## 4. 跨故事的不可观测到可观测：状态机与错误语义

### 4.1 讨论状态机（唯一合法迁移）

```
draft        ──生成嘉宾(generate)→ generating ──成功→ draft（guests.locked=0，阵容待确认）
generating   ──校验失败/超时──────────────────────→ failed
draft        ──确认(confirm)→ ready（guests.locked=1 + agent_status 建行 + 逐人 agent.status 事件）
ready        ──开始(start)→ running
running      ──收尾完成→ finished
running      ──全部发言失败→ failed
draft|generating|ready|running ──取消(cancel)→ cancelled
```

- `generating` 是**瞬时态**：成功即回到 `draft`（此时已有 `locked=0` 的阵容），失败才停在 `failed`。
- `cancelled` 是**终态**，与 `failed` 严格区分：`cancelled` 的 `error_code` 恒为 NULL，前端文案为「已取消」而非「失败」。
- 其他迁移一律拒绝：返回 409 `INVALID_STATE_TRANSITION` 且 `status` 不变（AC 由 S1 契约承接）。
- `GET /api/discussions/{id}` 的 `status` 与 SSE 的 `state.*` 必须由**同一个函数**计算（`AGENTS.md` §6.7）。

### 4.2 错误码（前端只按 `code` 分支）

| HTTP | code | 触发条件 |
|---|---|---|
| 400 | `INVALID_INPUT` | 话题/人数不合法 |
| 404 | `DISCUSSION_NOT_FOUND` | 讨论 id 不存在 |
| 409 | `GUESTS_ALREADY_LOCKED` | 已有 `locked=1` 嘉宾，仍请求生成 |
| 409 | `GUEST_COUNT_MISMATCH` | 确认时 `guests` 行数 ≠ `expert_count + 1` |
| 409 | `INVALID_STATE_TRANSITION` | 状态机不允许的迁移 |
| 409 | `TOO_MANY_RUNNING` | 同时 `running` 已达 3 场 |
| 422 | `GUEST_OUTPUT_INVALID` | 模型输出两次校验均失败 |
| 500 | `LLM_NOT_CONFIGURED` | `DEEPSEEK_API_KEY` 缺失 |
| 500 | `LLM_UPSTREAM_ERROR` | 模型服务不可用 / 超时 |

### 4.3 时间预算（超时即降级，不静默卡住）

| 环节 | 上限 | 超时行为 |
|---|---|---|
| 嘉宾生成 | 30s | → 500 `LLM_UPSTREAM_ERROR`（传输超时）；**校验不合法才是 422** `GUEST_OUTPUT_INVALID` |
| 单条发言 | 20s | 该 guest 记一次失败，状态回 `idle` |
| 共识 / 分歧提炼 | 15s | 跳过本窗口，不阻塞调度 |
| 收尾总结 | 30s | 返回「总结生成失败，请查看完整记录」，仍置 `finished` |

---

## 5. 硬约束落地映射（每条必须指向具体表 / 模块）

| # | 硬约束 | 落地位置（表 / 模块） | 可观测证据 |
|---|---|---|---|
| H1 | 五条数据流物理隔离 | 五张独立表 `agent_status` / `events` / `turns` / `consensus_points` / `divergence_points`；四族独立 SSE 事件 `agent.*` / `turn.*` / `consensus.*` / `divergence.*`（`state.*` / `run.*` 承载生命周期，另属 `events` 表） | AC-2.2 串流测试；无任何接口返回「五合一」数组 |
| H2 | 嘉宾生成后锁定 | `guests.locked=1` + `uq_guests_one_host` 部分唯一索引；`modules/guest` 生成前查锁；`modules/turn` 只读 `locked=1` 行 | AC-1.4（409 且行数不变）；AC-1.7（单事务置锁） |
| H3 | 共识分歧增量更新 | `consensus_points` / `divergence_points` 的 `status(provisional→final→dropped)` + `updated_seq`；`modules/summary` 归并 | AC-1.18（中途新增）；AC-1.19（归并）；前端按 `updated_seq >` 增量渲染 |
| H4 | 页面不整页滚动 | `web/src/styles` 布局（`html,body,#app{height:100%;overflow:hidden}` + `.studio{height:100dvh}` + Grid + `min-height:0`）；内层 `overflow-y:auto` | AC-3.7（三档断言的 `scrollHeight === innerHeight`） |
| H5 | Key 只在后端 | 唯一模型出口 `server/src/llm/`，只读 `process.env.DEEPSEEK_API_KEY`；`llm_calls` 只记 module / 耗时 / token / 重试 / 错误摘要；`web/` 不含任何 env 读取 | AC-1.6；构建产物中 `grep -r DEEPSEEK` 仅命中 `server/` |

补充约束（同样不可绕）：

| # | 约束 | 落地位置 |
|---|---|---|
| H6 | `events` 是唯一可重放源 | `events(discussion_id, seq)` 唯一索引；SSE 补发只读该表 |
| H7 | 调度决策是纯函数 | `modules/host/decide.ts` 不出现 `Date.now` / `Math.random` / `fetch` / `db` / `llm` import |
| H8 | 两处 `status` 同源 | `modules/discussion/status.ts` 单一计算函数，REST 与 SSE 共用 |

---

## 6. 非目标（本 spec 不验收，不得实现）

见根 `AGENTS.md` §2。任何「顺手做」的非目标功能都视为范围外改动，验收时不计分。

---

## 7. 裁决记录（原 NEEDS CLARIFICATION 已全部关闭）

| # | 问题 | 裁决 | 落地位置 |
|---|---|---|---|
| 1 | 首页是否含 `finished` / `failed` | **返回全部**，接口加 `?active=1` 可选过滤，前端分两组 | AC-3.1 / AC-3.2 |
| 2 | 专家人数上限 | **`[1,8]` 不变**；色板扩到 **10 色**（原 8 色撑不住 1 主持 + 8 专家） | `data-model.md` §2.2 色板 |
| 3 | "轮"的口径 | **不计主持人**；2 条专家发言 = 1 个提炼窗口 | AC-1.18 |
| 4 | 发言上限 | **20 条专家发言**（≈10 个提炼窗口） | AC-1.13 |
| 5 | cancel 是否独立状态 | **新增终态 `cancelled`**，与 `failed` 严格区分，`error_code` 恒为 NULL | §4.1 / AC-1.24 / AC-3.2 |
| 6 | 观察者与发起者能力 | **后端不校验**（v1 无鉴权）；前端按 `session_id` 比对隐藏四个写操作入口 | AC-3.8 |
| 7 | 并发 `running` 上限 | **≤ 3 场**，超限 `start` 返回 409 `TOO_MANY_RUNNING` | AC-2.10 |
| 8 | 样例阵容行数 | **1 主持 + 4 专家 = 5 行 `guests`**（`expert_count=4` 是默认值） | `data-model.md` §6 |

**同时修掉的 5 个契约缺陷**（审查发现，非 AI 原稿）：

| 缺陷 | 修法 |
|---|---|
| `turns.content` 限 120 字，但 `summary` 要 150–250 字，CHECK 必冲突 | 改为按 `speech_type` 分支：专家 ≤120，`opening/summary` ≤400 |
| 8 色板 + `uq_guests_color` 使 9 位嘉宾无法建 | 色板扩到 10 色 |
| `locked` 由谁置 1 未定义，与 AC-1.4 自相矛盾 | 生成写 `locked=0`，确认才置 1；确认前重复生成先删旧行（AC-1.4） |
| `agent_status` 初始状态无对应事件，`updated_seq` 停在 0，破坏"事件流唯一可重放" | 确认时逐人写 `agent.status` 事件（AC-1.7） |
| 全篇无"禁止机械轮流"的正向验收 | 新增 AC-1.21（`speech_type` ≥3 种、不连续同一人） |

---

## 8. 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-17 | v0.1 | S0 初稿：US-1/2/3 + 36 条 EARS 验收 + 硬约束映射 + 7 条待裁决 |
| 2026-11-17 | v1.0 | 裁决 7 条 + 关闭 8 条；修 5 个契约缺陷（turns 长度 CHECK / 色板容量 / locked 归属 / agent_status 无事件 / 缺反轮流验收）；新增 AC-1.7b、AC-1.21–1.24、AC-2.10、AC-3.8；状态机新增 `cancelled` |
| 2026-11-17 | v1.1 | 补 AC-1.25：主持人每 4 条专家发言插入 1 次追问（F3 的"追问 / 串联"此前无任何验收标准，也无实现归属） |
