# AGENTS.md — AI Panel Studio

> 本文件是本仓库对 AI 编码助手的唯一契约。任何会话开始前必读。
> 纪律：本文件 ≤150 行。细节搬进 `docs/`，这里只留指针。

---

## 0. 当前阶段（每次 Session 结束由人更新，只改这一段）

- 当前 Session：`S3`（S0/S1 已冻结；S2 已完成：9 张表 + 迁移 + seed + zod + 20 个测试全绿）
- 已完成：S0 契约、S1 接口与事件协议、S2 骨架与数据层
- 下一步：S3 嘉宾生成与锁定（`server/src/modules/guest/**`）
- 已知未决：LLM 凭据未配置（`/health` 会返回 `llm: "missing"`，不影响 S3 的 fake 测试；真调模型前需配）

---

## 1. 这个项目是什么

「AI Panel Studio」：用户输入议题 + 专家人数（默认 4），系统生成主持人 + 专家阵容
（姓名 / 职业 / 立场 / 专属色），用户确认后进入演播厅，观看一场由 AI 驱动、实时推进的
圆桌讨论；结束后得到**自然语言**总结 + 共识 / 分歧清单。

一次交付 = **一个能完整跑通一场讨论的 MVP**，不是一个功能齐全的产品。

---

## 2. 非目标（v1 明确不做，任何 Session 不得引入）

- 不做登录 / 注册 / 权限 / 多租户（用匿名 `sessionId` 即可）
- 不做付费、计费、额度管理
- 不做移动 App、不做 PWA 离线、不做 i18n
- 不做 RAG、向量库、微调、多模型路由
- 不做语音 / TTS / 数字人头像 / 视频导出
- 不做分享链接、不做导出 PDF
- 不引入 Redux / MobX / GraphQL / tRPC / Prisma / 任何 ORM

> 理由：评分看的是工程拆解与 AI 掌控力，不是功能数量。
> 多做一个非目标功能，就少一次测试覆盖。想做的东西写进 `docs/BACKLOG.md`。

---

## 3. 真相源优先级（冲突时按此裁决；裁不了就停下问人）

1. `docs/REQUIREMENTS.md` —— 作业原文，最高
2. `specs/001-panel/spec.md` —— 行为与验收标准
3. `specs/001-panel/contracts/` —— 接口与事件协议
4. `specs/001-panel/data-model.md` —— 表结构与不变量
5. 本文件 —— 工程约束
6. `docs/DESIGN.md` —— 视觉契约（前端样式唯一源，优先级同 5）
7. 对话 —— 仅当人明确说"覆盖 spec"时生效

**发现 spec 与 data-model 冲突：停止写代码 → 输出冲突点 → 等人裁决。**

---

## 4. 技术栈（已冻结，不要提议替换）

| 层 | 选型 |
|---|---|
| 前端 `web/` | Vue 3.5 + Vite + TypeScript + Pinia + Tailwind CSS v4 |
| 后端 `server/` | Node 22 + Fastify + TypeScript + better-sqlite3 + zod |
| 共享 `shared/` | zod schema + 由 schema 推导的 TS 类型（前后端唯一契约） |
| 数据库 | SQLite 单文件 `server/data/app.db`，迁移在 `server/src/db/migrations/` |
| 测试 | Vitest（单元/集成）+ Playwright（E2E） |
| 包管理 | pnpm workspace |
| 模型 | DeepSeek（OpenAI 兼容接口），Key 只从 `process.env.DEEPSEEK_API_KEY` 读 |

**已预批准的前端依赖**（`pnpm add` 时不必再问，除此之外仍走 Ask first）：
`pinia`、`vue-router`、`@playwright/test`。
**Tailwind 不再作为必需项**：样式改由 `tokens.css + atoms.css` 负责（单一源、无需 purge 配置、
离线可用）。要用 Tailwind 只允许做布局工具类，**不允许用它写颜色/字号/间距的语义值**。
**S7 必须加载 `impeccable` 技能**做视觉，但最终落点必须是 `docs/DESIGN.md` 定义的 token，
skill 负责品味，token 负责一致。

---

## 5. 目录地图

```
server/src/
  db/           连接、迁移、seed（seed 与迁移是 events 表的唯一合法直写例外）
  llm/          模型调用唯一出口 + config.ts（唯一读 Key 的地方）
  modules/
    discussion/ 讨论 CRUD、start/cancel、状态计算（status.ts）
    guest/      嘉宾生成（generate）与锁定（confirm）
    host/       主持人账本（ledger、prompt）与调度决策（decide）  ← 核心
    turn/       发言生成 + runner.ts（开场→循环→收尾的主循环）
    summary/    增量提炼（extract）+ 结束总结（summary）+ 归并（merge）
    sse/        事件总线、订阅、断线补发、publishEphemeral
shared/schemas/ zod：Guest / Turn / Event / Ledger / Consensus / Health
web/src/
  views/        HomeView、GuestConfirmView、TheaterView
  components/
    common/     AppButton / AppCard / AppBadge / AppPanel / AppEmpty  ← 唯一基础件
    theater/    演播厅业务组件
    guest/      嘉宾卡片等
  styles/       tokens.css（唯一 token 源）、atoms.css（基础件样式）、expert-colors.ts
  stores/       discussion.ts（五份独立 state，不得合并）
  api/          client.ts + events.ts（fetch + ReadableStream，不用 EventSource）
  mock/         S7 的假数据
tests/          单元与集成（guest / host / sse / discussion / runner / summary）
e2e/            Playwright
specs/001-panel/
```

---

## 6. 架构不变量（改任何一条都算破坏契约）

1. **所有模型调用只走 `server/src/llm/`。** 其他文件不得 import 模型 SDK、不得拼 baseURL、不得读 API Key。
2. **Key 永不出现在 `web/`。** 前端只调本机 API。
3. **两段式锁定**：`generate` 写 `locked=0`（阵容待确认），`confirm` 在单事务内翻成 `locked=1`。此后任何发言只能引用 `locked=1` 的行；不允许在内存里"顺手加一个嘉宾"。确认前重复 `generate` 必须先删掉旧的 `locked=0` 行。
4. **五条数据流物理隔离**：`agent_status`（状态）/ `events`（事件流）/ `turns`（transcript）/ `consensus_points` / `divergence_points` —— 各自独立表、独立 API、独立 SSE 事件族。**禁止塞进同一个 JSON 数组让前端筛。**
5. **调度决策是纯函数**：`server/src/modules/host/decide.ts` 不读 `Date.now()`、不读 `Math.random()`、不发网络请求、不碰数据库。时间 / 随机数 / 账本全部作为入参注入。
6. **`events` 表是唯一可重放源**：每条事件带 `discussion_id + seq`（会话内单调递增）。SSE 断线补发只读这张表。
7. **`GET /api/discussions/:id` 的 `status` 与 SSE 推送的 `status` 必须由同一个函数计算**，不许两处各写一套。
8. 前端**不展示**原始 JSON、不展示 chain-of-thought、不展示 `ledger` 表内容。总结必须是自然语言。
9. **共识 / 分歧是增量写的**：每 2 轮发言触发一次提炼，写入 `consensus_points` / `divergence_points` 并置 `status='provisional'`；讨论结束时做一次归并，保留项置 `status='final'`。前端按 `updated_seq` 增量渲染，**不整块重刷**。
   （这样既满足"实时更新"，又不会每轮都多打一次模型调用烧额度。）
10. **线上字段一律 snake_case**：API JSON、SSE payload、zod schema key、DB 列名四者同名，**禁止在中间做 camel↔snake 映射**。契约文件（`contracts/`）是唯一拼写权威。
11. **前端样式只能引用 `web/src/styles/tokens.css` 的变量**。组件里禁止出现 `#hex` / `rgb()` / `hsl()`，间距只用 `--sp-1..7`。自查：`grep -rn "#[0-9a-fA-F]\{6\}" web/src/components` 必须为空。
12. **`color_id` → CSS 变量只有一个映射点**：`web/src/styles/expert-colors.ts` 的 `expertColorStyle()`。任何组件不得写 `if (id === 'amber')`，不得维护第二份色表。
13. **业务组件只能用 `components/common/` 的 5 个基础件拼**；要新样式先扩 `docs/DESIGN.md` + `tokens.css` + `atoms.css`，再写组件。禁止在业务组件里重造按钮/输入框。

---

## 7. 边界（Always / Ask first / Never）

**Always**
- 改完立刻跑本 Session 的验收命令，并把输出贴回对话
- 只改本 Session 声明允许的文件
- 每个 Session 结束前更新 §0
- 新表 / 新字段先改迁移文件，再改代码

**Ask first**
- 新增任何依赖
- 修改 `specs/001-panel/contracts/**` 或 `data-model.md`
- 新增路由
- 改变 SSE 事件名或 payload 结构

**Never**
- `as any` / `@ts-ignore` / `@ts-expect-error`
- 提交 Key、`server/data/*.db`、`node_modules`
- 一次提交跨越多个模块的大 diff
- 为了让测试通过而删测试、放宽断言、注释业务逻辑
- 在 `web/` 里 mock 掉真实接口然后声称"跑通了"
- 自己发明 spec 里没有的功能

---

## 8. 完成定义（DoD，每个 Session 收尾自查）

- [ ] 只改了声明范围内的文件（`git status --short` 自查）
- [ ] 验收命令跑过且通过，输出已贴
- [ ] `pnpm check` 通过（tsc + vitest）
- [ ] §0 已更新
- [ ] 没有新增依赖（有则已获批）
- [ ] 没有引入 §2 非目标里的东西

---

## 9. 会话协议（每次开场固定动作，不可跳）

1. 读 §0 → 读本 Session 指定的输入文件 → 用**一行**复述：
   `本次执行 S{n}：<一句话>，允许改：<文件列表>`
2. 复述与 `docs/SESSION_MAP.md` 里 S{n} 的定义不一致 → **停下，问人**
3. 只做这一个 Session 的事，做完就停，不"顺手优化"
4. 汇报格式固定：**改了哪些文件 / 验收命令 / 输出 / 遗留问题**

---

## 10. 偏离信号 → 纠正话术（人用）

| 它干了什么 | 你就说 |
|---|---|
| 顺手重构别的模块 | 停。你改了 `<路径>`，不在本次范围。还原它，只保留 `<范围>` 的改动。 |
| 一次写太多文件 | 只保留 `<文件A>`，其余 checkout 掉，然后只做 `<单一任务>`。 |
| 编造字段 / 事件名 | 以 `shared/schemas/*.ts` 为准，不要新增字段。真缺就停下来告诉我。 |
| 把状态和 transcript 混一起 | 状态走 `agent.*` 事件族，transcript 走 `turn.*`，两者不得共用 payload。 |
| 开始写 README / 加注释大礼包 | 停。文档是 S11 的事，现在只交代码和测试。 |
