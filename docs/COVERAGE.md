# COVERAGE.md — 需求 → 验收标准 → 实现归属

> **这张表是"需求是否有人做"的唯一机械检查。** 每次 Session 收尾都要更新「状态」列。
>
> 规则：任何一行只要**没有 AC** 或**没有实现归属**，就说明这条需求没人做 —— 跟测试绿不绿无关。
> S2 漏了 4 个模块、S4 漏了"主持人追问"，都是靠肉眼发现问题；有了这张表，变成逐行对账。

需求来源：`docs/REQUIREMENTS.md` 的 F1–F7（功能）/ T1–T4（技术）。AC 在 `specs/001-panel/spec.md`。

---

## F 功能需求

| 需求 | 原文要点 | 验收标准 | 实现归属 | 状态 |
|---|---|---|---|---|
| **F1** | 首页列出讨论；可加入观察；可发起新讨论 | AC-1.1、AC-1.2（建讨论）、AC-1.24（取消）、AC-3.1、AC-3.2、AC-3.3、AC-3.4、AC-3.5、AC-3.6、AC-3.7、AC-3.8 | S6.5 `modules/discussion` + S7 `HomeView`/`DiscussionCard`/`NewDiscussionForm` + S7.5 视觉重排 + S8 `stores/home` + **S9 AC-3.8（本机 UUID 比对，写入口整块不渲染）** | ✅ 真数据全链路；AC-3.8 已实现并为浏览器实测，自动化断言留 S10 E2E |
| **F2** | 生成主持人 + 专家（姓名/职业/立场/专属色）；用户确认后进演播厅 | AC-1.3、AC-1.4、AC-1.5、AC-1.6、AC-1.7、AC-1.7b | S3 `modules/guest`（generate，locked=0）+ S6 `guest/confirm.ts`（locked=1） | ✅ 生成 + confirm 均完成（S3 / S6） |
| **F3** | 主持开场 / 追问 / 串联 / 收尾；专家自主决定顺序（抢答·补充·反驳），每次 1–2 句，**不机械轮流** | AC-1.8（开场）、AC-1.9、AC-1.10（超长截断）、AC-1.11（降级）、AC-1.12（停摆收尾）、AC-1.21（反轮流）、**AC-1.25（追问）**、AC-1.13（收尾） | S4 `host/ledger`（调度）+ S5 `host/decide`（决策）+ S6.5 `turn/runner`（主循环）+ `host/interject`（追问） | ✅ 服务端闭环（runner + 追问，13 条测试 + 真调）；E2E 待 S10 |
| **F4** | 专家状态小窗：待机 / 准备发言 / 发言中 + 当前关注点；**不展示 CoT** | AC-1.20、AC-1.23 | S6.5 runner 写 `agent_status` + S7 `ExpertCard`/`ExpertStatusBadge` + S7.5 视觉重排 + S8 `stores/discussion` + **S9 方案 C（模型调用前单独提交 speaking）** | ✅ 真事件接线、store 零定时器；`speaking.test.ts` 断言可见窗口 = 模型调用耗时（真调 1815 / 1048ms） |
| **F5** | 过程中**持续**提炼共识与分歧，实时更新，不等结束 | AC-1.18（过程）、AC-1.19（定稿） | S6.5 `summary/extract`（每 2 条）+ S8 `stores/discussion` 增量渲染 + **S9 `summary/merge`（final/dropped）+ `support_guest_ids` 回填 + store 过滤 dropped** | ✅ 增量 + 收尾归并 + support 映射均有测试；dropped 单向不可复活 |
| **F6** | transcript 显示姓名 + 职业 + 与专家一致的色块；**不显示"举手"等内部事件** | AC-1.22（色块）、AC-1.23（只渲染 turn.done） | S7 `TranscriptFeed`/`TranscriptItem`（姓名+职业+2px 专家色条）+ S7.5 视觉重排 + **S8 只由 `turn.done` 建条目** | ✅ 接线完成：刷新后 22 条全部由事件重放重建 |
| **F7** | 结束由主持人以**自然语言**总结；**禁止把 JSON 原文显示到页面** | AC-1.14、AC-1.15、AC-1.16（全部失败→failed）、AC-1.17 | **S9 `summary/summary.ts`（150–250 硬校验）+ `discussion/retry.ts` + `SummaryPanel` 三态** + S8 事件渲染 | ✅ 长度硬校验/一次重试/越界截断补齐；空 transcript、全失败、超时三兜底；retry 仅 ALL_SPEAKERS_FAILED |

**AC 分配核对**：`spec.md` 现有 **44 条** AC（AC-1.1 至 AC-1.25 含 AC-1.7b、AC-2.1 至 AC-2.10、AC-3.1 至 AC-3.8），
上表已全部落到某一行 F/T 需求下，无悬空条目。新增 AC 必须同步落到这张表里，否则视为"没人做"。

## T 技术需求

| 需求 | 原文要点 | 验收标准 | 实现归属 | 状态 |
|---|---|---|---|---|
| **T1** | Key 只在后端环境变量，不暴露到浏览器 | AC-1.6 + 不变量 H5 | S2 `llm/config.ts`（唯一读点）+ S3 `llm/client.ts`（唯一出口） | ✅ 已完成 |
| **T2** | 多讨论并行；状态 / 事件流 / transcript / 共识分歧互相隔离 | AC-2.1、AC-2.2、AC-2.3、AC-2.4、AC-2.5、AC-2.8、AC-2.10 | S6 `sse/bus`（按 discussion_id 隔离）+ S6.5 | ✅ S6 `sse/bus` 隔离 / 补发 / 清理已测 |
| **T3** | SSE / WebSocket 实时更新 | AC-2.3（补发）、AC-2.6（心跳）、AC-2.7（清理）、AC-2.9（seq 去重） | S6 `modules/sse` + **S8 `api/events.ts`（fetch + ReadableStream，不用 EventSource）** | ✅ 服务端 S6；前端补发/404 不重连/1-2-4s 退避/`seq` 去重均在 `api/events.ts` |
| **T4** | 响应式：不依赖整页滚动，各区域独立滚动；超宽 / 普通 / 窄屏 | AC-3.7 | S7 `views/*` + `PageShell` + `.studio-shell` 二层壳 + S7.5 统一页框 | ✅ 审查复测：9 个「视口×页面」组合 `scrollHeight===innerHeight` 且无横溢；左边缘 1440/1280=24、390=16 |

---

## 状态图例

| 标记 | 含义 |
|---|---|
| ✅ | 已实现且有测试覆盖 |
| 🟡 | 部分实现（拆成了两个 Session，前一半已完成） |
| ⏳ | 尚未开始，已指定 Session |
| ❌ | **无 AC 或无归属** —— 出现这个标记必须当轮解决，不允许带到下一轮 |

---

## 检查方法（每个 Session 收尾执行，30 秒）

1. 打开本文件，逐行看「验收标准」列：有没有空着的？
2. 逐行看「实现归属」：这个模块真的存在吗？`Test-Path` 一下，别信记忆。
3. 更新「状态」列：本轮做完的改成 ✅ 或 🟡。
4. 如果本轮新增了 AC，同步加一行；如果发现某条需求没有 AC，**先补 spec 再做代码**。
5. 引用一次到 PROMPT_LOG 的收尾段落：本轮关掉了哪几行。

> 历史教训：S2 时 4 个模块无人认领（F1 / F3 主循环 / AC-1.18 提炼 / 首页），
> S4 时 F3 的"追问"没有任何 AC 兜着。两次都是 42 条测试全绿的状态下发现的。

