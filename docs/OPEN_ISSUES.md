# OPEN_ISSUES — 未决事项（审查 session 维护）

> `AGENTS.md §0` 只留阶段指针；「还没解决、且会影响后续 Session」的问题都放这里。
> 每条写清：问题 / 影响 / 归属。修完就删，不留历史。

## 阻塞下一轮的

（无。）

## 已知但不阻塞

1. **种子讨论 `session_id` 为 NULL**：按 AC-3.8 严格比对，所有种子场次对任何浏览器只读
   （确认页不渲染写入口）。演示与 E2E 必须走「发起新讨论」；种子只用于列表与回看。
2. **结构化 `supporters` 只在 fake / 单测验证过**：真实模型若漏填或写错名字，降级为空支持
   （不会把对手算成支持者）。下次真调时抽检一条即可，不为此再烧一轮额度。
3. **`retry-summary` 的并发闸是进程内的**：单进程 Fastify 下第二个请求 409、零模型调用；
   若将来多进程/多实例部署，必须换成 DB 级锁或状态预占。
4. `guests/generate` 不发 `state.generating` / `state.draft` → `events.md` 已写明「当前不发送」，保持。
5. 单条发言失败会让 `turns.turn_no` 留空洞（正常路径不触发）；`ledger.turn_no` 已独立单调。
6. `expert_color_ids` 依赖 SQLite 聚合 `ORDER BY`（≥3.44）→ 换库前要重测。
7. `streaming` / `startedTurns` 已按契约维护，但服务端不发 delta、UI 也不渲染 →
   保留给后续流式（README「后续改进」已写明），不是死状态。
8. 总结面板在小屏（≤600）靠内部滚动（390 下 250 字 sh 318 > ch 270）；断言用 `scrollHeight`。
9. `.e2e/app.db` 会随每次 E2E 累积场次（seed 只清 `sample=1`）。目录已 gitignore；想清零就删 `.e2e/`。
10. **E2E 首跳 `NETWORK_ERROR` 仍未复现**（浏览器→Vite 一跳，7 次里 1 次）。现在
    `e2e/global-setup.ts` 先验证 `/health` 与 `Vite→API /api/discussions`，再用真实浏览器加载一次首页，
    把冷启动/预热窗口吸收在 setup 里；失败即中止，不是测试重试。若再复发，先抓 `test-results/` 的 trace。
11. **vitest 改为单 fork 有性能代价**：17 文件 / 110 测试约 4s（并行约 2s）。这是为消除
    tinypool 的 worker 回收竞态，不接受用 testing retries 换速度。
12. **E2E 截图是产物**：`e2e/screenshots/` 被 gitignore；验收截图单独放在 `D:\temp\s11-shots\`。

## 已修（勿重复做）

- S8 复审：404/断线错误面板、`confirm`/`start` 拆分防死锁、动作失败不再整页替换内容。
- S9 复审：retry 的 `reason` 改为 `retry_summary`；总结面板改内部滚动；`openapi.yaml` 补 retry 契约。
- S10 复审：`docs/TEST.md` 的「107 行内」笔误；`SESSION_MAP §S10` 允许清单补入口/DB/测试文件。
- S11 复审：PRD 的「10 元额度」与「分享链接」两处不实/矛盾；support 的「3 人同意列 4 个名字」
  不可复现，降级为语义风险描述；`SESSION_MAP §S11` 只勾代码侧。
- S11.5（子 agent + 审查复核）：
  * `support_guest_ids` 改为模型结构化 `supporters` + 精确姓名映射；旧字符串格式降级为空支持，
    子串匹配删除；新增 5 条测试。事件/DB 结构未变。
  * `retry-summary` 加单进程并发闸：第二个请求 409、零模型调用；并发测试断言 1 条 summary turn/1 次调用。
  * `pnpm check` 的一次性失败抓到栈：tinypool `Channel closed`（worker 回收时 IPC 已关）。
    先试 `fileParallelism:false` 仍复现，改单 fork 后 20 连跑无复现。
  * E2E 加 `global-setup.ts`（代理路径就绪 + 浏览器预热，三次上限、失败即中止），两遍 `2 passed`。
