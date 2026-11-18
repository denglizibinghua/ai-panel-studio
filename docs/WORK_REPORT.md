# 工作说明 — AI Panel Studio

> 数字出处：`docs/SESSION_MAP.md`、`docs/PROMPT_LOG.md`、`docs/COVERAGE.md` 与 zip 包 `evidence/`；
> 模型证据只取 S11 真跑库，不引用 `.e2e` 隔离库。

## 1. 开发流程（工具与模型）

工具是 **OpenCode**，不是 Claude Code（作业允许任意 Vibe Coding 工具）。模型走 DeepSeek 的 OpenAI 兼容接口，
**型号以接口返回为准**：本轮实际服务 `deepseek-flash`（`llm_calls.model` 落库即此值），文档不写无法自证的型号。
辅助工具：`impeccable` 技能定视觉方向、Playwright 做视口断言与截图、SQLite 直查做事件重放取证。

流程五步：① **先冻结契约**——S0 写 44 条 EARS 验收标准 + 9 张表，S1 写 10 个端点与 6 个事件族；
② **切 Session**——每个 Session 只交一个「命令能跑绿」的产物，下一个的输入必须是上一个已提交的文件，
`AGENTS.md` 是唯一跨会话契约；③ **一 Session 一独立会话**，会话间不共享记忆，逼我把上下文压进文档；
④ **审查会话独立复跑**——重跑命令、复现缺陷、修契约，多数真问题在这一步暴露；
⑤ **先取证后写文档，再分层提交**——前缀 `docs: → schema: → feat: → ui: → test/e2e:`，`git log --oneline` 可复核。

## 2. 拆解（S0–S11）

| 阶段 | 产物 | 关键约束 |
|---|---|---|
| S0–S1 契约 | 44 条 EARS + 9 张表 + openapi + 事件协议 | 每个事件必须挂 AC 编号 |
| S2 骨架 | Fastify + 迁移 + 5 条样例 | seed 可重复，不写 `running` 死场 |
| S3 生成 | `guests/generate` + zod 二次校验 + 两段式锁定 | 校验通过才落库 |
| S4–S6.5 调度 | `host/ledger` + `decide` 纯函数 + SSE + 主循环 | 先落库后推送；决策不读时间与随机数 |
| S7–S8 界面 | 三页 + STAGE 设计系统 + 五份独立 state | 不整页滚动；专家色单一来源 |
| S9–S11 收口 | 总结硬校验 + retry + E2E + 真调取证 | `summary_text` 与 summary turn 逐字相同 |

拆解原则：一个 Session 只解决一类问题，验收靠命令不靠感觉。S6.5 是审查补的洞——「讨论 CRUD + 主循环」
当时没有任何 Session 认领，这是拆解本身的漏洞，不是实现问题。

## 3. 三个真实卡点（摘自 `PROMPT_LOG`）

**① 审计字段写死（S3）**：`llm_calls.module` 在 client 里写成字面量 `'guest'`，33 条测试全绿——因为当时只有一种调用；
S4 账本、S6.5 发言接进来后所有调用都被记成 guest，「调了几次模型」整体失真。修法：改 `LlmModule` 由调用方显式传，加回归断言。

**② `matchMedia` 在视口仿真下不触发（S7）**：监听器触发 0 次而 `matches` 已为 true，390px 下阵容/现场/简报三块叠在
同一个 grid 格里，1440 截图完全看不出。修法：断点交给 CSS，验收加「390 下同时可见面板数 === 1」。

**③ 只有真跑才露出的问题（S6.5 / S11）**：空发言失败重试导致 `turn_no` 复用，`turn.started` 比 `turn.done` 多 2 条
（29 vs 27）；ledger JSON 4/23 解析失败。前者写成「按 `(guest_id, turn_no)` 幂等」的契约，后者列为已知质量项。

## 4. 真调证据（S11）

真 Key、无 fake，从 UI 走完：discussion 81，270 秒，27 条 turn（1 开场 + 20 专家 + 5 追问 + 1 总结），总结 195 字；
该场 68 行 `llm_calls` 全部 `deepseek-flash`，4 次重试成功、9 行失败。`pnpm check` 17 文件 / 110 条全绿，
`pnpm e2e` 两遍各 `2 passed`；9 张截图（1440/1280/390）在 zip 包 `screenshots/`。预估 1–3 分钟、实际 4.5 分钟，
所以 E2E 必须走 fake。

## 5. 对「工程化 AI 开发」的理解

AI 擅长局部实现，弱在跨阶段耦合——它不知道 S9 要写 200 字总结，也不知道 S3 早于 S6。所以重点不是写更好的 Prompt，
而是把 AI 放进一个有边界、有证据、可回退的流程：契约先冻结、Session 切小、审查独立、验收可复现。
Prompt 记录是审计日志，不是交差材料——同一个 bug 第二次出现时，能查到第一次是怎么被引导修好的。
一句话：**人定义边界与证据，AI 在边界内把活干完；能被复现的才算完成。**

## 6. 已知限制（不掩盖）

- `support_guest_ids` 已改为模型结构化输出 + 精确姓名校验；模型漏填时降级为空（不猜）。
- 并发 `retry-summary` 由单进程闸挡住（第二个请求 409、零模型调用）；多进程部署需换 DB 级锁。
- `pnpm check` 的一次性失败定位为 tinypool `Channel closed`，改单 fork 后 20 连跑未复现；
  E2E 首跳 `NETWORK_ERROR` 加了 globalSetup 预热门，两者都不加重试。
