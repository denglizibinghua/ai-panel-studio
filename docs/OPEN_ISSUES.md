# OPEN_ISSUES — 未决事项（审查 session 维护）

> `AGENTS.md §0` 只留阶段指针；「还没解决、且会影响后续 Session」的问题都放这里。
> 每条写清：问题 / 影响 / 归属。修完就删，不留历史。

## 阻塞下一轮的

（无。S10 已清空 S8/S9 复审留下的全部阻塞项。）

## S11 开工前必须处理

1. **主库没有真调证据**：`llm_calls` 现在是 0。此前那 20 条 `deepseek-flash` 是 fake 失败调用
   （transport 抛错拿不到响应 model，client 回落到默认模型名），随 E2E 场次一起删了，**不可恢复、不可当证据**。
   用户已决定 S11 跑。做法：真 Key 跑一场（1–3 分钟）→
   `SELECT module, model, success, COUNT(*) FROM llm_calls GROUP BY 1,2,3` 必须看到
   `deepseek-flash` 且 `success=1` 的行；`WORK_REPORT` 只引用这一次的库，不引用 `.e2e/app.db`。
2. **`web/src/mock/mock.ts` 已无引用**（S10 用真实 API + fake provider，不再需要假数据源）。
   S11 二选一：删掉，或在 README 说明保留理由。别留成"看起来在用"的死文件。

## 已知但不阻塞

3. **种子讨论 `session_id` 为 NULL**：按 AC-3.8 严格比对，所有种子场次对任何浏览器只读
   （确认页不渲染写入口）。演示与 E2E 必须走「发起新讨论」；种子只用于列表与回看。
4. **`support_guest_ids` 是姓名子串启发式**：句子提到某位专家即算支持；「陈砚秋并不同意」也会误算。
   MVP 接受，S11 文档如实写，不为它再调模型。
5. **并发 retry-summary**：两个请求同时进来会各打一次模型调用，第二个在事务里撞状态迁移回滚
   （数据不会坏，只多烧一次调用）。低优先，不修。
6. `?state=` QA 开关仍在四个视图里（已接真实 store 状态）→ S11 删并重拍截图。
7. `guests/generate` 不发 `state.generating` / `state.draft` → `events.md` 已写明「当前不发送」，保持。
8. 单条发言失败会让 `turns.turn_no` 留空洞（正常路径不触发）；`ledger.turn_no` 已独立单调。
9. `expert_color_ids` 依赖 SQLite 聚合 `ORDER BY`（≥3.44）→ 换库前要重测。
10. 浏览器控制台一条 `favicon.ico` 404 → S11 顺手补或忽略。
11. `streaming` / `startedTurns` 已按契约维护，但服务端不发 delta、UI 也不渲染 →
    保留给后续流式；若最终不做，S11 前删掉，避免死状态。
12. 总结面板在小屏（≤600）靠内部滚动（390 下 250 字 sh 318 > ch 270）；断言用 `scrollHeight`，
    不要用面板高度判断。
13. `.e2e/app.db` 会随每次 E2E 累积场次（seed 只清 `sample=1`）。目录已 gitignore，不影响交付库；
    想清零就删 `.e2e/`。
14. **`pnpm check` 在 S10 首跑失败过一次**（`ELIFECYCLE Test failed`，未保存完整输出），
    随后单测 5 连绿 + 全链路 2 次绿，未复现，也没有根因。再犯时先存完整日志再判断，别先怪测试。
15. **E2E 首跑偶发 `NETWORK_ERROR`**（浏览器→Vite 一跳，7 次里 1 次；DEBUG 下 server 未退出）。
    已加 `/health` 预检让失败直接说「后端未就绪」，但根因未定位。S11 不再追，除非复发。
16. **E2E 截图是产物**：`e2e/screenshots/` 被 gitignore；是否收进交付物由 S11 决定。

## 已修（勿重复做）

- S8 复审：404/断线错误面板、`confirm`/`start` 拆分防死锁、动作失败不再整页替换内容。
- S9 复审：retry 的 `reason` 改为 `retry_summary`；总结面板改内部滚动；`openapi.yaml` 补 retry 契约。
- S10 复审：`docs/TEST.md` 的「107 行内」笔误；`SESSION_MAP §S10` 允许清单补入口/DB/测试文件。
