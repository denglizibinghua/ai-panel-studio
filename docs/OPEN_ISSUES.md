# OPEN_ISSUES — 未决事项（审查 session 维护）

> `AGENTS.md §0` 只留阶段指针；「还没解决、且会影响后续 Session」的问题都放这里。
> 每条写清：问题 / 影响 / 归属。修完就删，不留历史。

## 阻塞下一轮的

1. **`speaking` 在服务端是瞬时的（裁定：方案 C，S9 实现）**
   `runner.finishTurn` 把 `speaking` / `turn.done` / `idle` 写在同一个事务里，三帧同批到达，
   浏览器只渲染最后一帧 → AC-1.20 的「发言中」原本不可观测。S8 在 store 里加的 600ms 驻留
   **只是展示层桥**，不是契约行为。
   **S9 改**：`beginTurn` 仍把 `turn.started + agent.status(preparing)` 在模型调用前提交；
   在**调用模型之前**单独提交一条 `agent.status(speaking)`；`finishTurn` 只写
   `turns + turn.done + idle`。然后**删掉 store 里的 dwell**（`SPEAKING_DWELL_MS`、定时器、
   「同时最多一位发言中」的补偿逻辑）。
   **不做流式**：AC-1.20 不要求 token 级；`turn.delta` 的实现代价（LLM 流式解析、取消、
   半截内容）与收益不成比例。
   验收：真跑一场，`speaking` 可见时长 ≈ 单次模型调用耗时（1–3s）；`turn.delta` 仍为 0 帧也不报错。

2. **AC-3.8 未实现（纯前端，S9 做）**
   生成并持久化 `sessionId`（localStorage，UUID），`POST /api/discussions` 带上；
   详情返回的 `session_id` 与本地不同 → 隐藏「生成 / 确认 / 开始 / 取消」四个写入口，
   且不留可点击的隐藏按钮。后端不校验（spec §3.7 明示 v1 无鉴权）。

3. **共识 / 分歧的 `dropped` 不得渲染（S9 做）**
   S9 归并会把被推翻项置 `dropped`；现在 store 与面板都不过滤，会当成正常条目显示。
   归属二选一：`stores/discussion.ts` 的 `applyPoint` 或 `ConsensusBoard` 渲染层，**别两处都写**。

## 已知但不阻塞

4. `support_guest_ids` 恒为空（S6.5 `extract` 写 `[]`）→ S9 回填姓名到 id 的映射。
5. `?state=` QA 开关仍在四个视图里（已接真实 store 状态）→ S11 删并重拍截图。
6. `guests/generate` 不发 `state.generating` / `state.draft` → `events.md` 已写明「当前不发送」，保持现状。
7. 单条发言失败会让 `turns.turn_no` 留空洞（正常路径不触发）；`ledger.turn_no` 已独立单调。
8. summary 150–250 字目前靠 prompt 约束 → S9 做硬校验。
9. `expert_color_ids` 依赖 SQLite 聚合 `ORDER BY`（≥3.44，better-sqlite3 自带 3.50）→ 换库前要重测。
10. `web/src/mock/mock.ts` 只留给 S10 E2E；生产路径已无 import。
11. 浏览器控制台一条 `favicon.ico` 404 → S11 顺手补或忽略。
12. `streaming` / `startedTurns` 已按契约维护，但服务端不发 delta、UI 也不渲染 →
    保留给 S10/后续流式；若最终不做流式，S11 前删掉，避免死状态。

## 本轮已修（S8 复审，勿重复做）

- 404 / 详情请求失败时 `loadError` 无人渲染 → 演播厅现在显示「无法打开这场讨论」+ 重试。
- `confirm` 成功但 `start` 失败会死锁（重试二次 confirm 撞 409）→ 拆成 confirm / start 两步，
  重试只重发 start；`detail.status='running'` 时按钮直接进演播厅。
- 动作失败会整页替换已加载内容（首页列表 / 确认页阵容）→ 改成行内错误，内容保留。
