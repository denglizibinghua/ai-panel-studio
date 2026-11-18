# OPEN_ISSUES — 未决事项（审查 session 维护）

> `AGENTS.md §0` 只留阶段指针；「还没解决、且会影响后续 Session」的问题都放这里。
> 每条写清：问题 / 影响 / 归属。修完就删，不留历史。

## 阻塞下一轮的

（无。S9 已清空 S8 复审的三项：`speaking` 根治、AC-3.8、`dropped` 过滤。）

## 已知但不阻塞

1. **种子讨论 `session_id` 为 NULL**：按 AC-3.8 严格比对，所有种子场次对任何浏览器都是只读
   （确认页不渲染写入口）。演示与 E2E 必须走「发起新讨论」；种子只用于列表与回看。
2. **`support_guest_ids` 是姓名子串启发式**：句子提到某位专家即算支持；若句子写的是
   「陈砚秋并不同意」，也会把陈砚秋算成支持者。MVP 接受；S11 文档里如实说明，不额外调模型。
3. **并发 retry-summary**：两个请求同时进来会各打一次模型调用，第二个在事务里撞状态迁移回滚
   （数据不会坏，只多烧一次调用）。低优先，不修。
4. `?state=` QA 开关仍在四个视图里（已接真实 store 状态）→ S11 删并重拍截图。
5. `guests/generate` 不发 `state.generating` / `state.draft` → `events.md` 已写明「当前不发送」，保持现状。
6. 单条发言失败会让 `turns.turn_no` 留空洞（正常路径不触发）；`ledger.turn_no` 已独立单调。
7. `expert_color_ids` 依赖 SQLite 聚合 `ORDER BY`（≥3.44，better-sqlite3 自带 3.50）→ 换库前要重测。
8. `web/src/mock/mock.ts` 只留给 S10 E2E；生产路径已无 import。
9. 浏览器控制台一条 `favicon.ico` 404 → S11 顺手补或忽略。
10. `streaming` / `startedTurns` 已按契约维护，但服务端不发 delta、UI 也不渲染 →
    保留给 S10/后续流式；若最终不做流式，S11 前删掉，避免死状态。
11. 总结面板在小屏（≤600）靠内部滚动兜住 250 字（S9 复审实测 390 下 sh 318 > ch 270）；
    S10 的视觉断言别用「面板高度」判断，改用 `scrollHeight` 判断。

## 已修（勿重复做）

- S8 复审：404/断线错误面板、`confirm`/`start` 拆分防死锁、动作失败不再整页替换内容。
- S9 复审：retry 的 `reason` 改为 `retry_summary`；总结面板改内部滚动；`openapi.yaml` 补 retry 契约。
