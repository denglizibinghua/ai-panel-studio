# OPEN_ISSUES — 未决事项（审查 session 维护）

> `AGENTS.md §0` 只留阶段指针；「还没解决、且会影响后续 Session」的问题都放这里。
> 每条写清：问题 / 影响 / 归属。修完就删，不留历史。

## 阻塞下一轮的

（无。S10 已清空 S8/S9 复审留下的全部阻塞项。）

## S11 开工前必须处理

（已清空。S11 已用真 Key 跑完 discussion 81 并取证：该场次 68 行 `llm_calls` 全部
`model='deepseek-flash'`；`web/src/mock/mock.ts` 已删除。证据见 `docs/WORK_REPORT.md` §4。）

## 已知但不阻塞

3. **种子讨论 `session_id` 为 NULL**：按 AC-3.8 严格比对，所有种子场次对任何浏览器只读
   （确认页不渲染写入口）。演示与 E2E 必须走「发起新讨论」；种子只用于列表与回看。
4. **`support_guest_ids` 是姓名子串启发式**：句子提到某位专家即算支持；「陈砚秋并不同意」也会误算。
   MVP 接受，S11 文档如实写，不为它再调模型。
5. **并发 retry-summary**：两个请求同时进来会各打一次模型调用，第二个在事务里撞状态迁移回滚
   （数据不会坏，只多烧一次调用）。低优先，不修。
6. `?state=` QA 开关已删除（S11），三页不再有任何 query 覆盖入口；9 张截图已重拍。
7. `guests/generate` 不发 `state.generating` / `state.draft` → `events.md` 已写明「当前不发送」，保持。
8. 单条发言失败会让 `turns.turn_no` 留空洞（正常路径不触发）；`ledger.turn_no` 已独立单调。
9. `expert_color_ids` 依赖 SQLite 聚合 `ORDER BY`（≥3.44）→ 换库前要重测。
10. favicon 404 已修（`web/index.html` 内联 SVG data URI），无新增静态文件。
11. `streaming` / `startedTurns` 已按契约维护，但服务端不发 delta、UI 也不渲染 →
    决定**保留**给后续流式（README「后续改进」已写明），不是死状态，删掉反而要重写契约。
12. 总结面板在小屏（≤600）靠内部滚动（390 下 250 字 sh 318 > ch 270）；断言用 `scrollHeight`，
    不要用面板高度判断。
13. `.e2e/app.db` 会随每次 E2E 累积场次（seed 只清 `sample=1`）。目录已 gitignore，不影响交付库；
    想清零就删 `.e2e/`。
14. **`pnpm check` 在 S10 首跑失败过一次**（`ELIFECYCLE Test failed`，未保存完整输出），
    随后单测 5 连绿 + 全链路 2 次绿，未复现，也没有根因。再犯时先存完整日志再判断，别先怪测试。
    （S11 复跑 16 文件 / 104 测试全绿，仍未复现。）
15. **E2E 首跑偶发 `NETWORK_ERROR`**（浏览器→Vite 一跳，7 次里 1 次；DEBUG 下 server 未退出）。
    已加 `/health` 预检让失败直接说「后端未就绪」，但根因未定位。S11 不再追，除非复发。
16. **E2E 截图是产物**：`e2e/screenshots/` 被 gitignore。S11 决定：验收截图不进仓库，
    单独放在 `D:\temp\s11-shots\` 并附路径；仓库只保留生成脚本以外的文档说明。

## 已修（勿重复做）

- S8 复审：404/断线错误面板、`confirm`/`start` 拆分防死锁、动作失败不再整页替换内容。
- S9 复审：retry 的 `reason` 改为 `retry_summary`；总结面板改内部滚动；`openapi.yaml` 补 retry 契约。
- S10 复审：`docs/TEST.md` 的「107 行内」笔误；`SESSION_MAP §S10` 允许清单补入口/DB/测试文件。
