# PRD — AI Panel Studio（v1 / MVP）

## 一句话

输入一个议题，系统自动组建「1 位主持人 + N 位专家」，用户确认后进入演播厅，实时观看一场由模型驱动、
顺序自主、可重放、可收尾的圆桌讨论。

## 目标

1. **一次能跑完**：新建 → 生成阵容 → 确认 → 实时讨论 → 自然语言总结，全程不刷新页面、不出现原始 JSON。
2. **过程可信**：五条数据流（状态 / 事件 / transcript / 共识 / 分歧）物理隔离；断线重连按 `seq` 补发，不丢帧。
3. **成本可控**：每次模型调用落一行 `llm_calls`（模块 / 模型 / 耗时 / token / 是否重试 / 是否成功），
   `10 元额度`与「这场讨论调了几次模型」都能用 SQL 回答。

## 用户与场景

| 角色 | 说明 | 权限 |
|---|---|---|
| 发起者 | 本机浏览器首次访问时生成并持久化匿名 `sessionId` | 可创建 / 生成 / 确认 / 开始 / 取消 |
| 观察者 | 同一 URL 的其它浏览器（`session_id` 不一致） | 只读：看直播、看总结、看共识分歧，不渲染任何写入口 |

典型场景：① 发起一场 4 位专家的议题讨论并看完；② 分享链接给同学围观（只读）；③ 回看首页已结束场次的总结与结论。

## 范围（v1 要做）

| 优先级 | 能力 | 覆盖 |
|---|---|---|
| P1 | 跑通一场完整讨论（含失败/取消/重试兜底） | F1–F7 |
| P2 | 多场讨论并行互不干扰（SSE 按 `discussion_id` 隔离） | T2 |
| P3 | 首页分组列表、观察者加入、回看历史 | F1 / AC-3.8 |

## 非目标（v1 明确不做）

登录/权限/多租户、付费计费、移动 App/PWA/多语言、RAG/向量库/多模型路由、语音/TTS/数字人/视频导出、
分享链接/PDF 导出、Redux/MobX/GraphQL/tRPC/ORM（完整列表见 `AGENTS.md §2`）。

## 验收标准映射（`docs/COVERAGE.md` 为唯一机械核对表）

| 需求 | 验收标准 | 实现归属 |
|---|---|---|
| F1 列表 / 新建 / 观察 | AC-1.1、1.2、1.24、AC-3.1–3.8 | `modules/discussion` + `HomeView` + `stores/home` + AC-3.8 本机 UUID 比对 |
| F2 生成 + 确认阵容 | AC-1.3–1.7b | `modules/guest`（generate）+ `guest/confirm`（locked=1） |
| F3 主持开场/追问/串联/收尾 | AC-1.8–1.12、1.21、1.25、1.13 | `host/ledger` + `host/decide` + `turn/runner` + `host/interject` |
| F4 专家状态小窗（无 CoT） | AC-1.20、1.23 | `agent_status` + `ExpertCard` / `ExpertStatusBadge` |
| F5 过程中持续提炼共识/分歧 | AC-1.18、1.19 | `summary/extract`（每 2 条）+ `summary/merge`（final/dropped） |
| F6 transcript 姓名+职业+色块 | AC-1.22、1.23 | `TranscriptFeed` / `TranscriptItem`（只认 `turn.done`） |
| F7 自然语言总结 | AC-1.14–1.17 | `summary/summary.ts`（150–250 硬校验）+ `retry-summary` + `SummaryPanel` |
| T1 Key 只在后端 | AC-1.6 / H5 | `llm/config.ts`（唯一读点）+ `llm/client.ts`（唯一出口） |
| T2 多讨论隔离 | AC-2.1–2.5、2.8、2.10 | `sse/bus`（Map by `discussion_id`） |
| T3 SSE 补发 / 心跳 / 去重 | AC-2.3、2.6、2.7、2.9 | `sse/bus` + `api/events.ts`（fetch + ReadableStream） |
| T4 响应式、不整页滚动 | AC-3.7 | 三页栅格 + `.studio-shell` 容器 + 面板内滚动 |

## 产品约束（硬性）

- 单场专家发言上限 **20 条**；主持人开场/追问/总结不计入。
- 总结 **150–250 字**，且 `discussions.summary_text` 与 `speech_type='summary'` 的 turn 逐字相同（INV-9）。
- 页面不展示 ledger / chain-of-thought / 原始 JSON。
- 模型名只写实际服务返回的 `deepseek-flash`（`llm_calls.model` 即证据）。

## 里程碑

S0 契约 → S1 协议 → S2 地基 → S3 嘉宾 → S4 账本 → S5 决策 → S6 事件总线 → S6.5 主循环 →
S7/S7.5 三页与设计系统 → S8 接线 → S9 收尾兜底 → S10 E2E → **S11 真调取证 + 文档 + 提交**。
