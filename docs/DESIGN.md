# DESIGN.md — 视觉契约

> **这是前端唯一的样式真相源。** 任何 Session 加页面前先读这里；缺的 token 先补到这里和
> `web/src/styles/tokens.css`，再写组件。与 `AGENTS.md` §6 的第 11–13 条配套。

---

## 0. 三条不可绕的规则

1. **组件里不出现硬编码色值。** 禁止 `#hex`、`rgb()`、`hsl()`，一律 `var(--…)`。
   自查：`grep -rn "#[0-9a-fA-F]\{6\}" web/src/components` 必须为空。
2. **间距只用 7 档**：4 / 8 / 12 / 16 / 24 / 32 / 48。没有 20px，没有 5px。
3. **业务组件只能用 `components/common/` 的 5 个基础件拼**，不许自己写 `<button>` / `<input>` 的样式。

---

## 1. 基调

暗色演播厅。深底、低饱和、靠**专家色块**和**状态呼吸**提供信息密度，不靠装饰。

- 只有一个主题（暗色），**不做主题切换**（`AGENTS.md` §2 非目标）。
- 信息层级靠三层背景差 + 文字明度差，不靠边框堆叠。
- 动效只服务于"状态在变"（说话中、生成中），不做入场动画。

---

## 2. 色板

### 2.1 基底（6 个层次，不要新增）

| Token | 值 | 用在哪 |
|---|---|---|
| `--bg-base` | `#0b0f14` | 页面底 |
| `--bg-panel` | `#121821` | 侧栏 / 面板底 |
| `--bg-raised` | `#1a2230` | 面板上的卡片 |
| `--bg-inset` | `#0e141b` | 内嵌凹槽（transcript 区） |
| `--line-subtle` | `rgba(255,255,255,.06)` | 分隔线、卡片描边 |
| `--line-strong` | `rgba(255,255,255,.12)` | 可交互元素的描边 |

### 2.2 文字（3 档，不要新增）

| Token | 值 | 用途 |
|---|---|---|
| `--fg-primary` | `#e8edf4` | 正文、姓名、标题 |
| `--fg-secondary` | `#9aa7b8` | 职业、元信息、次级说明 |
| `--fg-muted` | `#5d6b7d` | 时间戳、占位、禁用 |

### 2.3 语义色

| Token | 值 | 用途 |
|---|---|---|
| `--accent` | `#6ea8fe` | 主操作、链接、选中 |
| `--accent-strong` | `#3f7fe0` | 主操作 hover |
| `--accent-bg` | `rgba(110,168,254,.14)` | 选中底 |
| `--danger` | `#f26d6d` | 失败、取消、破坏性操作 |
| `--danger-bg` | `rgba(242,109,109,.14)` | 危险按钮底 |
| `--success` | `#4ec98a` | finished、LIVE 点 |
| `--warn` | `#f5b642` | 生成中、停摆提示 |

### 2.4 专家色（10 个 id × 3 个用途）

`guests.color_id` 的取值与 `shared/schemas/enums.ts` 的 `colorIdValues` 一一对应。
每个 id 必须同时提供三档，缺一档算契约破坏：

| 后缀 | 用途 | 示例（amber） |
|---|---|---|
| `-fg` | 姓名、圆点、图标等前景 | `#f5b642` |
| `-bg` | 卡片底、发言气泡底（12% 透明度） | `rgba(245,182,66,.12)` |
| `-ring` | 描边、状态外圈（38% 透明度） | `rgba(245,182,66,.38)` |

| id | `-fg` | 语义倾向（只用于选角，不用于样式判断） |
|---|---|---|
| `amber` | `#f5b642` | 中立主持 |
| `rose` | `#f2708f` | 强硬 / 反对 |
| `sky` | `#5aa9f0` | 理性 / 分析 |
| `emerald` | `#3fbf87` | 务实 / 落地 |
| `violet` | `#a58bf5` | 理论 / 学术 |
| `orange` | `#f2884b` | 产业 / 一线 |
| `teal` | `#35bfbf` | 数据 / 研究 |
| `lime` | `#a3cc48` | 增长 / 机会 |
| `indigo` | `#7c86f0` | 制度 / 政策 |
| `fuchsia` | `#e067c9` | 创意 / 传播 |

> **唯一映射点**：`web/src/styles/expert-colors.ts` 的 `expertColorStyle(id)`。
> 组件里禁止 `if (id === 'amber')`，禁止自己维护第二份色表。

---

## 3. 排版

- 字体：`--font-ui`（Inter → PingFang SC → 微软雅黑 → system-ui）。中文优先 PingFang/雅黑，
  **不要引入外部字体文件**（离线可用是第一原则）。
- 数字与代码：`--font-mono`。

| Token | 字号 / 行高 | 用途 |
|---|---|---|
| `--fs-xs` | 12 / 1.5 | 时间戳、徽标 |
| `--fs-sm` | 13 / 1.6 | 元信息、辅助文案 |
| `--fs-base` | 14 / 1.7 | 正文默认（transcript、表单） |
| `--fs-md` | 16 / 1.6 | 姓名、卡片标题 |
| `--fs-lg` | 20 / 1.4 | 页面区块标题 |
| `--fs-xl` | 28 / 1.25 | 首页主标题 |

字重只用 400 / 500 / 600（`--fw-regular` / `--fw-medium` / `--fw-strong`）。
**中文不用 700 以上**（在 Windows 上会糊）。

---

## 4. 间距 / 圆角 / 描边

- 间距：`--sp-1` 4 / `--sp-2` 8 / `--sp-3` 12 / `--sp-4` 16 / `--sp-5` 24 / `--sp-6` 32 / `--sp-7` 48。
- 圆角：`--r-sm` 6（徽标、小按钮）/ `--r-md` 10（按钮、卡片）/ `--r-lg` 14（面板）/ `--r-full` 999（圆点）。
- 描边固定 1px。**不要用 box-shadow 做层次**，用背景明度差；只有 `speaking` 状态允许发光。

---

## 5. 动效

| Token | 值 | 用途 |
|---|---|---|
| `--dur-fast` | 150ms | hover、颜色切换 |
| `--dur-base` | 250ms | 展开、淡入 |
| `--ease` | `cubic-bezier(.2,.7,.3,1)` | 全局缓动 |

只有两种动效是必须的：
1. `generating` / `preparing` / `running` 的 **呼吸**（opacity 或 ring 缩放，1.8s 循环）。
2. `turn.delta` 到达时的光标闪烁。

**必须尊重 `prefers-reduced-motion: reduce`**：所有循环动画在该媒体查询下停掉。

---

## 6. 状态语义（这套必须三处一致：roster / transcript / 顶部状态条）

### 6.1 专家状态（`agent_status.state`）

| 状态 | 圆点 | 卡片底 | 其他 |
|---|---|---|---|
| `idle` | 6px，`--fg-muted` | `--bg-raised` | — |
| `preparing` | 6px，专家 `-fg`，外圈 2px `-ring`，呼吸 | 专家 `-bg` 的 60% | 右下角显示 `focus` 文本（≤80 字，2 行截断） |
| `speaking` | 8px 实心 `-fg`，外圈 2px `-ring` | 专家 `-bg` | 左侧 2px `-fg` 竖条；允许微弱外发光 |

### 6.2 讨论状态（`discussions.status`）

| 状态 | 徽标 | 文案 |
|---|---|---|
| `draft` | neutral | 待生成 |
| `generating` | info + 呼吸 | 生成中 |
| `ready` | info | 待开始 |
| `running` | success + 呼吸点 | 进行中 |
| `finished` | neutral | 已结束 |
| `failed` | danger | 失败 |
| `cancelled` | neutral + 删除线 | 已取消 |

`cancelled` **不是** `failed`：文案与颜色都不同（AC-1.24）。

---

## 7. 组件清单

### 7.1 基础件（`components/common/`，已就绪）

| 组件 | 变体 | 说明 |
|---|---|---|
| `AppButton` | `primary` / `secondary` / `ghost` / `danger`，`sm`/`md`，`loading` | 全站唯一按钮 |
| `AppCard` | `raised`，`padded` | 卡片容器 |
| `AppBadge` | `neutral` / `info` / `success` / `warn` / `danger` / `expert`，`dot` | 状态与标签 |
| `AppPanel` | `title` + `actions` 插槽 + `scrollable` | 三栏的每一栏都用它 |
| `AppEmpty` | `title` + `hint` + 默认插槽 | 空态 / 未开始 |
| `AppInput` | `multiline`，`maxlength`，`label` | S7 新增：全站唯一文本输入（`atoms.css` 冻结期间样式留在 SFC 内，值仍全部来自 token） |
| `AppStepper` | `min` / `max`，`label` | S7 新增：数字步进器（内置 `−` / `+` 用 `AppButton size="sm"`，不自绘按钮） |

> 布局壳不在基础件之列：`components/layout/PageShell.vue` 只负责 `100dvh + overflow:hidden + 内部滚动`
> 的页面框架（Home / GuestConfirm 使用；Theater 用 `.studio-shell` 二层壳）。它不产出任何视觉控件。

### 7.2 业务组件（S7 产出，必须用上面的基础件拼）

`DiscussionCard`、`NewDiscussionForm`、`GuestCard`、`RosterPanel`、`ExpertCard`、
`ExpertStatusBadge`、`TranscriptFeed`、`TranscriptItem`、`ConsensusBoard`、`HostBar`。

---

## 8. 布局

- 壳：`height: 100dvh`（**不是 min-height**），`overflow: hidden`，页面永不滚动。
- **页面宽度只有三档，不许各写各的**（S7 的教训：首页 1400 / 确认页 1056 / 演播厅 1440，看着像三个产品）：

  | 类型 | 用在哪 | 规则 |
  |---|---|---|
  | 阅读列 | 首页列表、确认页卡片区 | 外壳 `max-width: var(--stage-max)` 居中，**内容列 `max-width: 80rem`（1280）居中**，行长 ≤ 80 中文字 |
  | 工作区 | 演播厅三栏 | 占满外壳不设内容 max（三栏已经限制了行长），但左右 gutter 与阅读列一致 |
  | 表单页 | 新建讨论 | 同阅读列，宽度取 48rem（768），不要撑满 |

- 页面左右 gutter 统一 `--sp-5`；页头高度统一（当前 64px），不要一页 50 一页 64。
- 演播厅三栏：`18rem / minmax(0,1fr) / 22rem`，间距 `--sp-4`。
- 每个面板内部自己滚：`overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable;`
- 响应式：1200px 折叠右栏为抽屉；900px 单栏 + 顶部标签切换。
  **容器自身的栅格变化用 `@media`，面板内部排布用 `@container`**（容器查询改不了容器自身）。
- 超宽（≥1800px）：`--stage-max: 1600px` 居中，不拉伸正文行长。

---

## 9. 空 / 加载 / 错误

| 场景 | 样子 |
|---|---|
| 列表为空 | `AppEmpty`：标题 + 一句提示 + 主操作按钮 |
| 生成嘉宾中 | 3 张骨架卡片（`--bg-raised` + 呼吸），不转圈 |
| 讨论未开始 | transcript 区 `AppEmpty`：「等待主持人开场」 |
| 共识/分歧暂空 | 各一行 `--fg-muted` 文案：「讨论中，暂无」 |
| 请求失败 | 该区域替换为 `AppEmpty` + `AppButton variant="secondary"` 重试 |
| 总结生成失败 | `AppEmpty` + 固定文案「总结生成失败，请查看完整记录」 |

**禁止**：整页 loading 遮罩、toast 弹窗报错、`alert()`。错误就地展示。

---

## 10. 验收自查（S7/S8/S9 交付前逐条回答）

- [ ] `grep -rn "#[0-9a-fA-F]\{6\}" web/src/components` 输出为空
- [ ] 三页的主操作按钮是同一个 `AppButton variant="primary"`（截图对比）
- [ ] 同一专家在 roster / transcript / 共识区的颜色同源（`expertColorStyle` 单一映射）
- [ ] 空 / 加载 / 失败三种状态都出现过，且视觉像一家人
- [ ] 1440 / 1280 / 390 三档下 `document.scrollingElement.scrollHeight === innerHeight`
- [ ] `prefers-reduced-motion: reduce` 下没有循环动画
