# events.md — SSE 事件协议（v1.0 · S1 冻结）

> 输入：`specs/001-panel/spec.md` v1.0、`specs/001-panel/data-model.md`
> 地位：`data-model.md` §2.4 把 `events.type` 的**精确取值与 payload 结构**委托给本文件。
> 本文件冻结后，改事件名或 payload 结构须走 `AGENTS.md` §7 的 Ask first。
> 与 `spec.md` 冲突 → 停止，输出冲突点，等人裁决（`AGENTS.md` §3）。

---

## 0. 范围与「7 个输出组」的口径

`data-model.md` §2.4 冻结的 `events.type` 前缀白名单只有 **6 个**：
`state.` / `run.` / `agent.` / `turn.` / `consensus.` / `divergence.`。

因此本协议的一层输出共 **7 组**，但只有 **6 组是持久事件族**：

| # | 输出组 | 持久（写 `events` 表） | 带 `id` | 说明 |
|---|---|---|---|---|
| 1 | `state.*` | 是 | 是 | 讨论状态变化（唯一状态真相） |
| 2 | `run.*` | 是 | 是 | 一次开始 / 结束 / 失败 / 取消（新增 `run.cancelled`，故比原计划多一个 type，**不是多一个族**） |
| 3 | `agent.*` | 是 | 是 | 专家状态 + 公开关注点 |
| 4 | `turn.*` | `turn.started` / `turn.done` 是；`turn.delta` 否 | `started` / `done` 是；`delta` 否 | transcript |
| 5 | `consensus.*` | 是 | 是 | 共识增量 |
| 6 | `divergence.*` | 是 | 是 | 分歧增量 |
| 7 | **控制帧**（`: ping`、`event: caught_up`） | 否 | 否 | 连接管理与补发完成信号，**不是事件族、不进 `events` 表、不占 `seq`** |

> **为什么不新造第 7 个点号前缀**：`events.type` 的 CHECK 只允许上表 6 个前缀；新造
> `stream.*` / `system.*` 会直接违反 `data-model.md` §2.4 与 INV-8，属于契约破坏。
> `cancelled` 因此落在 `run.` 族内（`run.cancelled`），不单独立族。

**一条不可绕的边界**：阵容（`guests`）**不进事件流**。观察者进入演播厅时先
`GET /api/discussions/{id}` 取阵容，再从 `Last-Event-ID: 0` 重放事件。理由是避免把
「阵容表」塞进事件 payload（H1：五流物理隔离），也避免 payload 随人数膨胀。

---

## 1. 传输层

### 1.1 连接

```
GET /api/discussions/{id}/events
Accept: text/event-stream
Last-Event-ID: 42          ← 可选；仅断线补发时携带
```

响应头（缺一不可）：

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

- 讨论 `id` 不存在 → **直接返回 404 `DISCUSSION_NOT_FOUND`（JSON），不建立 SSE 流**；
  前端此时**不得重连**（AC-3.6）。
- 服务端不得发送 `event: message`；每个持久帧的 `event:` 必须是本文件列出的 type 之一。

### 1.2 帧格式（持久事件）

```
id: <seq>
event: <type>
data: <payload JSON，单行>

```

- `id:` = 该讨论内 `events.seq` 的**字符串化整数**（`"7"`，不是 `7`，也不带前缀）。
  **每个持久事件必带**；客户端不得自行生成或改写。
- `event:` = `events.type` 原文。
- `data:` = `events.payload` 的 JSON 原文，**逐字节一致**，不得再包一层
  `{"discussion_id":..,"type":..,"payload":..}` 信封（信封信息由 `event:`/`id:` 承担）。
  单行输出（`\n` 需转义），长度 ≤ 4096 字节（`data-model.md` §2.4）。
- 帧之间以一个空行结束。

### 1.3 控制帧

```
: ping
```

- 15s 一次，**注释帧**：无 `id`、无 `event`、无 `data`，不推进 `seq`（AC-2.6）。

```
event: caught_up
data: {"up_to_seq":42}
```

- 补发阶段结束后**发送一次**；无 `id`，不落库，不占 `seq`。
- `up_to_seq` = 本次连接补发完成时该讨论已发出的最大 `seq`（一次都没补发时为 `0`）。
- 该帧语义 = 「你已追平到 `up_to_seq`，此后收到的都是新事件」。前端可据此隐藏 loading。

---

## 2. 序号、补发与生命周期

| 规则 | 内容 | 对应 AC |
|---|---|---|
| 序号范围 | `seq` 在**单个讨论内**从 1 起单调递增，跨讨论互不共享、互不跳号 | AC-2.1 |
| 取号 | 由 `discussions.last_event_seq` 单一计数器发放；无空洞、无重复（唯一索引兜底） | AC-2.4 |
| **补发 exclusive** | 携带 `Last-Event-ID: k` 时**只补 `seq > k`** 的事件；`seq == k` 绝不重发 | AC-2.3 |
| `k` 缺失 / 非法 | 按 `k = 0` 处理（等价全量重放）；不报错、不断连 | AC-2.3 |
| `k ≥ last_event_seq` | 补发 0 条，仍发一次 `caught_up` | AC-2.3 |
| 补发顺序 | 严格 `seq` 升序；不得并发乱序写帧 | AC-2.3 / AC-2.9 |
| 补发范围 | **只读 `events` 表**；`turn.delta` 从未落库，因此**永远不在补发范围内** | AC-2.3 / AC-1.9 |
| 隔离 | 只推送本体讨论的事件；A 的订阅者收到的 B 事件条数为 0 | AC-2.2 |
| 无订阅 | 订阅者全断开**不取消、不暂停**讨论，`status` 与调度不变 | AC-2.5 |
| 清理 | 连接关闭或报错后 1s 内清除心跳定时器并从订阅集合移除，集合归零 | AC-2.7 |
| 时序 | 先 `COMMIT` 后推送：允许「已落库未推送」，**永不出现「已推送未落库」** | `data-model.md` §4.4 |

> `seq` 是**每讨论独立**的，因此两个讨论可能同时推送 `id: 5`。前端必须以
> `discussion_id + seq` 作为去重键，不能只按 `seq` 全局去重。

---

## 3. 客户端铁律（AC-2.9 / H1）

1. **以 `seq` 为准**：按 `seq` 去重与排序；收到 `seq ≤` 已处理最大值的持久事件**直接丢弃**；
   **不得以到达顺序推断业务顺序**（AC-2.9）。SSE 只保证单连接内有序，不保证与落库顺序的
   业务因果，`seq` 才是唯一顺序权威。
2. **五流分离渲染**（H1 / AC-1.23）：
   - transcript 区**只**渲染 `turn.done`；
   - 专家小窗**只**消费 `agent.*`；
   - 共识区**只**消费 `consensus.*`，分歧区**只**消费 `divergence.*`；
   - `state.*` / `run.*` 只用于顶部状态条与运行提示；
   - transcript 区**不得**渲染 `agent.*` / `run.*` / `state.*`。
3. **重连**：用最后已处理的 `seq` 作 `Last-Event-ID`；收到 `caught_up` 后才算追平。
4. **`turn.delta` 是易失的**：只进临时缓冲（键 `guest_id + turn_no`），`turn.done` 到达时用其
   `content` **整体覆盖**缓冲区并转正为永久条目（AC-1.23）；断线期间的 delta 永久丢失，
   由 `turn.done` 补齐。

---

## 4. 总览：type 全名单

```
state.draft  state.generating  state.ready  state.running  state.finished
state.failed  state.cancelled
run.started  run.finished  run.failed  run.cancelled
agent.status
turn.started  turn.delta  turn.done
consensus.added  consensus.updated
divergence.added  divergence.updated
（控制帧：`: ping`、`event: caught_up`）
```

共 **19 个 type + 2 个控制帧**。下表逐族展开，每个 type 标注覆盖的 AC；
**没有 AC 支撑的 type 必须标「无 AC」并说明理由**（本文件仅 `state.generating` 一处）。

---

## 5. `state.*` — 讨论状态（唯一状态真相）

**payload 固定三字段，全族统一：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | enum | 本事件的**目标状态**，与 type 后缀同值 |
| `previous_status` | enum \| null | 迁移前状态；创建事件（`state.draft` 首条）为 `null` |
| `updated_at` | string(ISO-8601 UTC ms) | 迁移落库时间 |

**本族禁止携带**：`summary_text` / `error_code` / `expert_count` / guests / turns。
错误码归 `run.failed`，总结归 `turn.done`，阵容走 REST 详情。

| type | `status` | `previous_status` 允许值 | 触发时机 | 覆盖 AC |
|---|---|---|---|---|
| `state.draft` | `draft` | `null`（创建）/ `generating`（生成成功回落） | `POST /api/discussions` 成功时（`seq=1`）；`generate` 成功后回落到待确认 | AC-1.1（创建即 draft）；AC-1.3 / AC-1.4（生成成功回到 draft） |
| `state.generating` | `generating` | `draft` | `guests/generate` 开始调用模型时（瞬时态） | **无 AC 直接断言** —— 仅落地 spec §4.1 的 `generating` 瞬时态；评审若要求严格 AC 对齐可删，删除不影响任何 AC |
| `state.ready` | `ready` | `draft` | `guests/confirm` 事务提交后（同一事务内还写 N 条 `agent.status`） | AC-1.7 |
| `state.running` | `running` | `ready` | `start` 落库时；`run.started` 同刻发出 | AC-1.8 |
| `state.finished` | `finished` | `running` | 收尾总结 turn 定稿后 | AC-1.12 / AC-1.13 / AC-1.14 / AC-1.15 |
| `state.failed` | `failed` | `generating` / `running` | 生成失败或全部专家调用失败后 | AC-1.16 |
| `state.cancelled` | `cancelled` | `draft` / `generating` / `ready` / `running` | `cancel` 成功时；此后**不再产生任何 turn** | AC-1.24 |

帧示例：

```
id: 4
event: state.ready
data: {"status":"ready","previous_status":"draft","updated_at":"2026-11-17T08:30:20.000Z"}
```

> `state.*` 的 `status` 必须与 `GET /api/discussions/{id}` 的 `status` 由**同一个函数**计算
> （AGENTS §6.7 / H8）。前端只认 `state.*`，`run.*` 不携带 `status`。

---

## 6. `run.*` — 一次运行的生命周期

**本族禁止携带 `status` 字段**（避免与 `state.*` 形成两处真相，H8）。

### 6.1 `run.started`

| 字段 | 类型 | 说明 |
|---|---|---|
| `started_at` | string(ISO-8601) | 进入 `running` 的时间 |
| `expert_count` | integer 1–8 | 本场专家数（前端展示「N 位专家」用） |

触发：`start` 成功、`state.running` 同刻落库（`start` 响应返回前已落库）。
覆盖 AC：**AC-1.8**。

### 6.2 `run.finished`

| 字段 | 类型 | 说明 |
|---|---|---|
| `finished_at` | string(ISO-8601) | 进入 `finished` 的时间 |
| `reason` | enum | `max_turns` \| `request_satisfied` \| `stalled` \| `empty_transcript` |
| `expert_turn_count` | integer ≥ 0 | 本场专家发言条数（不含主持） |
| `summary_failed` | boolean | 收尾总结超时/失败（spec §4.3）→ `true`，此时 `summary` turn 内容为固定兜底文案 |

`reason` 与触发的对应：`stalled` = 停摆计数达 3（AC-1.12）；`max_turns` = 专家发言达 20；
`request_satisfied` = 账本判定 `is_request_satisfied=true`（AC-1.13）；`empty_transcript` =
`turns` 为 0（AC-1.15）。
覆盖 AC：**AC-1.12 / AC-1.13 / AC-1.14 / AC-1.15**（总结正文本身由 `turn.done`
`speech_type='summary'` 承载）。

### 6.3 `run.failed`

| 字段 | 类型 | 说明 |
|---|---|---|
| `failed_at` | string(ISO-8601) | 进入 `failed` 的时间 |
| `error_code` | enum | `LLM_NOT_CONFIGURED` \| `LLM_UPSTREAM_ERROR` \| `ALL_SPEAKERS_FAILED` |

**没有 `message` 字段**：`error_message` 仅供人工排查，不返回前端（AC-1.17 /
`data-model.md` §2.1）。
覆盖 AC：**AC-1.16**。

### 6.4 `run.cancelled`

| 字段 | 类型 | 说明 |
|---|---|---|
| `cancelled_at` | string(ISO-8601) | 进入 `cancelled` 的时间 |
| `previous_status` | enum | `draft` \| `generating` \| `ready` \| `running` |

覆盖 AC：**AC-1.24**。

> **`run.cancelled` 与 `run.failed` 是两个不同事件，payload 结构不共用**：
> `run.failed` 必带 `error_code`，`run.cancelled` **没有** `error_code` 字段。
> 禁止用「`run.failed` + `error_code: null`」表示取消 —— `cancelled` 的 `error_code`
> 在库里恒为 NULL，但事件层面必须用独立 type 表达语义（spec §4.1 / AC-1.24）。

---

## 7. `agent.*` — 专家状态（独立于 transcript）

### 7.1 `agent.status`

| 字段 | 类型 | 说明 |
|---|---|---|
| `guest_id` | integer | 对应 `guests.id`（同讨论内） |
| `state` | enum | `idle` \| `preparing` \| `speaking` |
| `focus` | string \| null | 公开关注点，≤ 80 字；**不得包含推理原文 / chain-of-thought** |

- `updated_seq` 不放进 payload：它就是本帧的 `id`（`agent_status.updated_seq` = 本事件 `seq`，
  `data-model.md` §2.8 / INV-6）。
- 触发时机：
  1. `confirm` 事务内为**每位**嘉宾写一条 `state='idle'`（`updated_seq` 必须取该事件 seq，
     不得留 0）→ AC-1.7；
  2. 运行期每次状态迁移 `idle → preparing → speaking → idle` 时写一条 → AC-1.20。
- 覆盖 AC：**AC-1.7 / AC-1.20**；约束面：AC-1.17（不得含推理原文）、AC-1.23（不得进
  transcript 区）。

帧示例：

```
id: 12
event: agent.status
data: {"guest_id":7,"state":"speaking","focus":"成本与体验的取舍"}
```

---

## 8. `turn.*` — transcript

### 8.1 `turn.started`

| 字段 | 类型 | 说明 |
|---|---|---|
| `guest_id` | integer | 即将发言的嘉宾 |
| `turn_no` | integer ≥ 1 | 该讨论内发言序号（与 `seq` 是两套编号） |
| `speech_type` | enum | `opening` \| `challenge` \| `supplement` \| `rebuttal` \| `question` \| `summary` |

触发：开始生成该条发言时（与 `agent.status(speaking)` 同一事务单元）。
覆盖 AC：**AC-1.9**（发言开始信号）；约束面：AC-1.23（该帧不得生成 transcript 条目）。

### 8.2 `turn.delta` —— **非持久，无 `id`**

| 字段 | 类型 | 说明 |
|---|---|---|
| `guest_id` | integer | 发言嘉宾 |
| `turn_no` | integer ≥ 1 | 归属哪条发言 |
| `delta` | string | 本次增量文本片段（可能是单字 / 半句，不保证句法完整） |

- **不落库**（AC-1.9 原文：「`turn.delta` 只承载流式片段，不写库」），因此**没有 `id` 行**，
  也不在补发范围内。
- 客户端只把它当易失缓冲；`turn.done` 到达后用 `content` 整体覆盖。
- 覆盖 AC：**AC-1.9**；约束面：AC-1.23（delta 期间的临时内容不得进位为永久条目）。

### 8.3 `turn.done` —— transcript 的唯一来源

| 字段 | 类型 | 说明 |
|---|---|---|
| `guest_id` | integer | 发言人；前端用它 join 阵容取 `color_id`（**payload 不含颜色**） |
| `turn_no` | integer ≥ 1 | 发言序号 |
| `speech_type` | enum | 同 8.1 |
| `content` | string | 定稿正文；专家 1–120 字（超长已按句末截断，AC-1.10），主持 `opening`/`summary` 1–400 字 |
| `createdAt` | string(ISO-8601) | 定稿落库时间 |

- 与 `turns` 表**一对一**：一条 `turn.done` ↔ 一行 `turns`，反之亦然（`data-model.md` §5）。
- 因 `events` 是唯一可重放源，`content` **必须**在事件里（否则 `Last-Event-ID: 0` 无法重建
  transcript）。
- **禁止**携带 `color_id` / `profession` / `agent.state` / `focus`：颜色与职业只能来自阵容
  Join（AC-1.22），状态只能来自 `agent.*`（H1）。
- 覆盖 AC：**AC-1.9**（定稿时同时写库并推送）、**AC-1.10**（内容为截断后文本）、
  **AC-1.14**（`speech_type='summary'` 承载总结正文）、**AC-1.21**（`speech_type` 多样性的可观
  察面）、**AC-1.22**（颜色一致性靠 `guest_id` 映射）、**AC-1.23**（transcript 唯一渲染来源）。

帧示例：

```
id: 31
event: turn.done
data: {"guest_id":7,"turn_no":9,"speech_type":"rebuttal","content":"我不同意这个前提，成本下降不等于体验提升。","createdAt":"2026-11-17T08:33:02.000Z"}
```

---

## 9. `consensus.*` — 共识增量

payload（`added` 与 `updated` 同形，靠 `status` 区分）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `point_id` | integer | `consensus_points.id` |
| `text` | string 1–120 | 一句话共识（讨论内唯一） |
| `status` | enum | `added` 恒为 `provisional`；`updated` 为 `final` \| `dropped` |
| `support_guest_ids` | integer[] | 支持该条的 `guests.id` 列表（可为空数组） |
| `round_no` | integer ≥ 1 | 首次出现的提炼窗口号 |

- `updated_seq`**不放进 payload**：它就是本帧的 `id`（`data-model.md` §2.6 / INV-6）。
  前端按「`updated_seq`（= 帧 `id`）单调推进」做增量渲染，**不整块重刷**（AGENTS §6.9）。

| type | `status` | 触发时机 | 覆盖 AC |
|---|---|---|---|
| `consensus.added` | `provisional` | 每完成 2 条专家发言触发一次提炼，新增条目写入时（**不必等讨论结束**） | AC-1.18 |
| `consensus.updated` | `final` \| `dropped` | 收尾归并：保留项置 `final`，被推翻项置 `dropped`，并刷新 `updated_seq` | AC-1.19 |

> 排序硬约束：`consensus.added` 的 `seq` **必须大于**触发它的那条 `turn.done` 的 `seq`
> （AC-1.18 原文）。与之同事务的 `turn.done` 先取号，提炼事件后取号。

---

## 10. `divergence.*` — 分歧增量

与 `consensus.*` **形状同构**（`data-model.md` §2.7），但**是独立族**：type 名不同、
payload schema 分开定义、前端**不得**把两族合并成同一个数组渲染（H1）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `point_id` | integer | `divergence_points.id` |
| `text` | string 1–120 | 一句话分歧（须写明对立两面） |
| `status` | enum | `added` 恒为 `provisional`；`updated` 为 `final` \| `dropped` |
| `support_guest_ids` | integer[] | 持正方观点的 `guests.id` 列表 |
| `round_no` | integer ≥ 1 | 首次出现的提炼窗口号 |

| type | `status` | 触发时机 | 覆盖 AC |
|---|---|---|---|
| `divergence.added` | `provisional` | 与共识提炼同一窗口，新增分歧条目写入时 | AC-1.18 |
| `divergence.updated` | `final` \| `dropped` | 收尾归并时 | AC-1.19 |

---

## 11. payload 卫生与「七族不共用」清单

1. **`events.payload` ≤ 4096 字节**，合法 JSON 对象，不含 prompt、不含 chain-of-thought、
   不含 `ledger` 行、不含 `raw_json`、不含 `error_message`（`data-model.md` §2.4 / AC-1.17）。
2. **六族 payload 不共用结构**：判别键各不相同 —— `state.*` 看 `status`+`previous_status`；
   `run.*` 看 `started_at` / `finished_at`+`reason` / `failed_at`+`error_code` / `cancelled_at`；
   `agent.*` 看 `guest_id`+`state`+`focus`；`turn.*` 看 `turn_no`+`content`；
   `consensus.*` 看 `point_id`+`text`+`provisional/final`；`divergence.*` 同构但独立命名空间。
   **禁止**用一个通用 `{type, data}` 壳把两族合并成同一 schema 校验。
3. **状态与 transcript 禁止混装**（H1）：`turn.done` 不带 `state` / `focus`；
   `agent.status` 不带 `content`；`state.*` 不带 turn / 共识 / 分歧内容。
4. **`run.*` 不带 `status`**：状态唯一真相是 `state.*`（H8）。
5. **`turn.done` 不带 `color_id`**：颜色唯一真相是 `guests.color_id`（AC-1.22）。
6. **取消不是失败**：禁止 `run.failed` + `error_code: null` 表达取消（AC-1.24）。
7. **`turn.delta` 不得有 `id`、不得落库、不得参与补发**（AC-1.9）。
8. **任何人不得在 `agent.status.focus` 里放推理原文**；`focus` ≤ 80 字，是「公开关注点」
   而非思考过程（AC-1.20 / F4）。

---

## 12. 事件 → 表映射（H1 的五流隔离证据）

| 事件族 | 唯一源头表 | 同事务同步更新 | 前端去向 |
|---|---|---|---|
| `state.*` / `run.*` | `events` | `discussions.status` / `started_at` / `finished_at` / `error_code` | 顶部状态条、运行提示 |
| `agent.*` | `events` | `agent_status`（`state` / `focus` / `updated_seq`） | 专家小窗 |
| `turn.*` | `events`（`turn.delta` 除外） | `turns` + `agent_status` | transcript |
| `consensus.*` | `events` | `consensus_points`（`status` / `updated_seq`） | 共识区 |
| `divergence.*` | `events` | `divergence_points`（`status` / `updated_seq`） | 分歧区 |

`events` 表是**唯一可重放源**（H6）：任何前端状态都必须能由「`GET 详情`（阵容）+ 从
`Last-Event-ID: 0` 重放」重建，不存在只在大脑/内存里的事件。

---

## 13. AC 覆盖矩阵

| AC | 由谁覆盖 | 事件层可见性 |
|---|---|---|
| AC-1.1 / 1.2 | `state.draft`（`seq=1`） | 1.2 的可观测面是 HTTP 400，不走事件 |
| AC-1.3 / 1.4 / 1.5 / 1.6 | `state.generating` → `state.draft`；失败走 `run.failed`（`status='failed'`） | 生成结果本身以 REST 响应为准 |
| AC-1.7 / 1.7b | `state.ready` + 逐人 `agent.status(idle)` | 人数不符走 HTTP 409，无事件 |
| AC-1.8 | `state.running` + `run.started` | 开场 turn 随后以 `turn.*` 送达 |
| AC-1.9 / 1.10 | `turn.started` / `turn.delta` / `turn.done` | `turn.done.content` 为截断后文本 |
| AC-1.11 | 无专属事件 | 降级由 `ledger.parse_status='fallback'` 记录，**不得**进事件流 |
| AC-1.12 / 1.13 | `run.finished.reason ∈ {stalled, max_turns, request_satisfied}` | `expert_turn_count` 可断言 20 上限 |
| AC-1.14 / 1.15 | `turn.done(speech_type='summary')` + `state.finished` | `run.finished.reason='empty_transcript'` |
| AC-1.16 | `run.failed` + `state.failed` | `error_code` 可断言 |
| AC-1.17 | 全部族的 payload 卫生规则（§11） | 任何帧都不得含 `ledger` / CoT |
| AC-1.18 | `consensus.added` / `divergence.added`（`provisional`） | 可断言 `seq >` 触发它的 `turn.done.seq` |
| AC-1.19 | `consensus.updated` / `divergence.updated`（`final` / `dropped`） | `updated_seq` = 帧 `id` |
| AC-1.20 | `agent.status`（`idle/preparing/speaking` + `focus`） | 可断言 ≤80 字且无推理原文 |
| AC-1.21 | `turn.done.speech_type`（旁证） | 真断言在 DB，事件只提供观察面 |
| AC-1.22 | `turn.done.guest_id` + 阵容 `color_id` | payload 不含颜色，颜色不漂移 |
| AC-1.23 | 客户端铁律 §3 + `turn.delta` 不落库 | transcript 只由 `turn.done` 产生 |
| AC-1.24 | `state.cancelled` + `run.cancelled` | `run.cancelled` 无 `error_code` |
| AC-2.1 | `seq` 每讨论从 1 起 | 两场同时运行可断言各自连续 |
| AC-2.2 | 订阅按 `discussion_id` 过滤 | 越界事件 0 条 |
| AC-2.3 | 补发 exclusive + `caught_up` | `seq == k` 必须不出现 |
| AC-2.4 | 唯一索引 + 单计数器取号 | 无空洞、无重复 |
| AC-2.5 / 2.7 | 无订阅不影响 `status`；1s 内清理 | 事件层无专属帧 |
| AC-2.6 | `: ping`（15s，无 `id`） | 心跳不推进 `seq` |
| AC-2.9 | 客户端按 `seq` 去重排序 | 「以 `seq` 为准，不得到达顺序推断业务顺序」 |
| AC-3.4 / 3.5 | 观察者与发起者共用同一 `events` / `seq`；`sample=1` 同一条路径 | 无分支 |
| AC-3.6 | 404 时不建流、不重连 | — |
| AC-2.8 / 2.10 / 3.1 / 3.2 / 3.3 / 3.7 / 3.8 | 与事件协议无关（DB 唯一约束 / HTTP 409 / REST 列表 / 前端布局与能力隐藏） | 不在本文件范围 |

**自称多造的 type**：`state.generating` 没有直接对应的 AC（仅落地 spec §4.1 的瞬时态），
其余 18 个 type 均至少对应 1 条 AC。
