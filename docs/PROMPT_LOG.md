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
- [ ] S1 · 接口与事件协议 — 阶段：SDD
- [ ] S2 · 工程骨架与 seed — 阶段：SDD
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
