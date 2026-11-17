import type {
  Guest,
  Turn,
  ConsensusPoint,
  DivergencePoint,
  DiscussionStatus,
  AgentState,
  SpeechType,
} from '@ai-panel/shared';

/**
 * S7 的假数据（docs/SESSION_MAP.md §S7）。
 *
 * 只做类型导入，zod 不会进 bundle；字段名与 shared/schemas 完全一致（snake_case）。
 * 时间戳必须是带毫秒的 ISO-8601 UTC，否则 schema 正则不通过。
 */

export interface MockDiscussion {
  id: number;
  topic: string;
  status: DiscussionStatus;
  expert_count: number;
  guest_count: number;
  created_at: string;
  updated_at: string;
  summary_text: string | null;
}

export interface MockAgentStatus {
  state: AgentState;
  focus: string | null;
  updated_seq: number;
}

export const mockDiscussions: MockDiscussion[] = [
  {
    id: 1,
    topic: '该不该给 AI 生成内容强制加水印？',
    status: 'running',
    expert_count: 4,
    guest_count: 5,
    created_at: '2026-11-17T08:00:00.000Z',
    updated_at: '2026-11-17T08:30:00.000Z',
    summary_text: null,
  },
  {
    id: 2,
    topic: '远程办公是否正在杀死城市 CBD？',
    status: 'running',
    expert_count: 4,
    guest_count: 5,
    created_at: '2026-11-16T14:00:00.000Z',
    updated_at: '2026-11-16T14:42:00.000Z',
    summary_text: null,
  },
  {
    id: 3,
    topic: '大学该不该开设 AI 通识必修课？',
    status: 'finished',
    expert_count: 4,
    guest_count: 5,
    created_at: '2026-11-15T09:10:00.000Z',
    updated_at: '2026-11-15T09:58:00.000Z',
    summary_text:
      '四位嘉宾围绕 AI 通识课的必要性展开争论：一方认为这是理解时代的最低门槛，另一方担心课程会沦为工具操作培训，最后落脚在师资与课程定位上。',
  },
  {
    id: 4,
    topic: '开源模型的商业化还有多少空间？',
    status: 'finished',
    expert_count: 4,
    guest_count: 5,
    created_at: '2026-11-14T10:20:00.000Z',
    updated_at: '2026-11-14T11:05:00.000Z',
    summary_text:
      '讨论了开源模型的商业化路径：许可证、托管服务与定制交付被反复提及，多数观点认为真正的护城河不在权重，而在数据闭环与工程能力。',
  },
  {
    id: 5,
    topic: '短视频算法该被监管到什么程度？',
    status: 'cancelled',
    expert_count: 4,
    guest_count: 5,
    created_at: '2026-11-13T16:00:00.000Z',
    updated_at: '2026-11-13T16:12:00.000Z',
    summary_text: null,
  },
  {
    id: 6,
    topic: '量化交易对散户是机会还是陷阱？',
    status: 'ready',
    expert_count: 4,
    guest_count: 5,
    created_at: '2026-11-12T08:45:00.000Z',
    updated_at: '2026-11-12T08:46:30.000Z',
    summary_text: null,
  },
  {
    id: 7,
    topic: 'AI 会不会让初级程序员消失？',
    status: 'failed',
    expert_count: 4,
    guest_count: 5,
    created_at: '2026-11-11T20:00:00.000Z',
    updated_at: '2026-11-11T20:04:00.000Z',
    summary_text: null,
  },
];

export const mockRoster: Guest[] = [
  {
    id: 1,
    discussion_id: 1,
    name: '林知远',
    profession: '主持人',
    stance: '中立梳理',
    color_id: 'amber',
    role: 'host',
    speaking_order: 0,
    locked: true,
  },
  {
    id: 2,
    discussion_id: 1,
    name: '陈砚秋',
    profession: '财经专栏作者',
    stance: '反对强制水印，成本会转嫁给中小创作者',
    color_id: 'rose',
    role: 'expert',
    speaking_order: 1,
    locked: true,
  },
  {
    id: 3,
    discussion_id: 1,
    name: '周律',
    profession: '平台合规顾问',
    stance: '支持先立规再优化标注方案',
    color_id: 'sky',
    role: 'expert',
    speaking_order: 2,
    locked: true,
  },
  {
    id: 4,
    discussion_id: 1,
    name: '何一鸣',
    profession: '独立开发者',
    stance: '反对，只会催生更隐蔽的规避工具',
    color_id: 'emerald',
    role: 'expert',
    speaking_order: 3,
    locked: true,
  },
  {
    id: 5,
    discussion_id: 1,
    name: '苏芮',
    profession: '传播学讲师',
    stance: '中立偏支持，公众知情权优先',
    color_id: 'violet',
    role: 'expert',
    speaking_order: 4,
    locked: true,
  },
];

const turnSeeds: ReadonlyArray<{
  id: number;
  guest_id: number;
  turn_no: number;
  speech_type: SpeechType;
  content: string;
  created_at: string;
}> = [
  {
    id: 101,
    guest_id: 1,
    turn_no: 1,
    speech_type: 'opening',
    content:
      '今晚我们聊一个正在落地的规则：AI 生成内容要不要强制加水印。先把边界说清楚——这里的水印指机器可读的来源标记，不是画面角落那行小字。今天按三个问题走：谁来标、标在哪、成本落到谁头上。四位嘉宾分别代表创作者、平台、开发者和公众视角，请各自用一句话把立场摆出来，后面我们再逐条拆成本和效果。',
    created_at: '2026-11-17T08:02:00.000Z',
  },
  {
    id: 102,
    guest_id: 2,
    turn_no: 2,
    speech_type: 'challenge',
    content:
      '先说成本。给每一条内容打标、存证、抽检，这些活儿最后都会摊到中小创作者头上，平台只会把它写进分成比例里。',
    created_at: '2026-11-17T08:04:00.000Z',
  },
  {
    id: 103,
    guest_id: 3,
    turn_no: 3,
    speech_type: 'rebuttal',
    content:
      '成本确实存在，但放任不管的代价更高。现在平台各自为政，重复建设；先统一标准，反而能把边际成本压下来。',
    created_at: '2026-11-17T08:06:30.000Z',
  },
  {
    id: 104,
    guest_id: 4,
    turn_no: 4,
    speech_type: 'supplement',
    content:
      '补一个技术现实：标记本身很容易被抹掉，转码一次就没了。如果不绑定传播链路，水印只是一层心理安慰。',
    created_at: '2026-11-17T08:09:00.000Z',
  },
  {
    id: 105,
    guest_id: 1,
    turn_no: 5,
    speech_type: 'question',
    content:
      '那我想追问何一鸣：如果标记在转码后就失效，你主张用什么替代？是抓传播端，还是干脆改监管目标？',
    created_at: '2026-11-17T08:11:30.000Z',
  },
  {
    id: 106,
    guest_id: 5,
    turn_no: 6,
    speech_type: 'challenge',
    content:
      '我换个角度。公众要的不是追责每一个文件，而是知道自己看到的是什么。只要这一点成立，方案可以比想象中轻。',
    created_at: '2026-11-17T08:14:00.000Z',
  },
  {
    id: 107,
    guest_id: 2,
    turn_no: 7,
    speech_type: 'rebuttal',
    content:
      '轻方案听起来很美，但让用户知道自己看到什么，落到产品上就是强制标注入口，这仍然是成本，只是换了个位置。',
    created_at: '2026-11-17T08:17:00.000Z',
  },
  {
    id: 108,
    guest_id: 3,
    turn_no: 8,
    speech_type: 'supplement',
    content:
      '监管目标可以分层：高风险场景强制，一般内容自愿。用分级替代一刀切，既保住知情权，也不把小团队挡在门外。',
    created_at: '2026-11-17T08:20:00.000Z',
  },
  {
    id: 109,
    guest_id: 4,
    turn_no: 9,
    speech_type: 'challenge',
    content:
      '分层我同意，执行我怀疑。谁来判断高风险？最后大概率还是平台说了算，小创作者连申诉的渠道都没有。',
    created_at: '2026-11-17T08:23:00.000Z',
  },
  {
    id: 110,
    guest_id: 1,
    turn_no: 10,
    speech_type: 'summary',
    content:
      '这一场我们的分歧其实不在目标，而在路径。大家都认同公众应该知道内容是不是 AI 生成的，但陈砚秋和苏芮在成本归属上没能谈拢：一方认为标注费用会压垮小创作者，另一方认为轻量标注足以覆盖知情权。周律提出的分级思路得到了多数认同，只是何一鸣提醒，分级一旦交给平台执行，判断权和申诉渠道必须一起写进规则，否则好设计会在落地时变形。',
    created_at: '2026-11-17T08:26:00.000Z',
  },
];

export const mockTurns: Turn[] = turnSeeds.map((seed) => ({
  ...seed,
  discussion_id: 1,
}));

export const mockConsensus: ConsensusPoint[] = [
  {
    id: 201,
    discussion_id: 1,
    text: '公众有权知道内容是否为 AI 生成，这一点不需要再争。',
    status: 'provisional',
    support_guest_ids: [2, 5],
    round_no: 2,
    updated_seq: 3,
    created_at: '2026-11-17T08:15:00.000Z',
    updated_at: '2026-11-17T08:15:00.000Z',
  },
  {
    id: 202,
    discussion_id: 1,
    text: '统一标准比平台各自为政更能降低整体标注成本。',
    status: 'provisional',
    support_guest_ids: [3, 4],
    round_no: 3,
    updated_seq: 5,
    created_at: '2026-11-17T08:21:00.000Z',
    updated_at: '2026-11-17T08:21:00.000Z',
  },
];

export const mockDivergence: DivergencePoint[] = [
  {
    id: 301,
    discussion_id: 1,
    text: '强制水印的成本该由谁承担：平台、创作者还是公共财政？',
    status: 'provisional',
    support_guest_ids: [2, 4],
    round_no: 2,
    updated_seq: 4,
    created_at: '2026-11-17T08:18:00.000Z',
    updated_at: '2026-11-17T08:18:00.000Z',
  },
  {
    id: 302,
    discussion_id: 1,
    text: '分级监管能否替代一刀切，高风险场景由谁认定？',
    status: 'provisional',
    support_guest_ids: [3, 5],
    round_no: 3,
    updated_seq: 6,
    created_at: '2026-11-17T08:24:00.000Z',
    updated_at: '2026-11-17T08:24:00.000Z',
  },
];

export const mockAgentStatus: Record<number, MockAgentStatus> = {
  1: { state: 'idle', focus: null, updated_seq: 6 },
  2: { state: 'speaking', focus: null, updated_seq: 7 },
  3: { state: 'preparing', focus: '水印的合规成本最终由谁承担？', updated_seq: 8 },
  4: { state: 'idle', focus: null, updated_seq: 9 },
  5: { state: 'idle', focus: null, updated_seq: 10 },
};

export function mockGuestById(id: number): Guest | undefined {
  return mockRoster.find((guest) => guest.id === id);
}
