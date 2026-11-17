import type { ColorId, DiscussionStatus, GuestRole, SpeechType } from '@ai-panel/shared';

export interface SeedGuest {
  name: string;
  profession: string;
  stance: string;
  color_id: ColorId;
  role: GuestRole;
  speaking_order: number;
}

/** `speaker` is 'host' or the 0-based expert index. */
export interface SeedTurn {
  speaker: 'host' | 0 | 1 | 2 | 3;
  speech_type: SpeechType;
  content: string;
}

export interface SeedPoint {
  text: string;
  /** 0-based expert indexes supporting the point. */
  support: number[];
  round_no: number;
}

export interface SeedDiscussion {
  topic: string;
  status: DiscussionStatus;
  base_time: string;
  started_at: string | null;
  finished_at: string | null;
  summary_text: string | null;
  guests: SeedGuest[];
  turns: SeedTurn[];
  consensus: SeedPoint[];
  divergence: SeedPoint[];
}

export const SAMPLE_DISCUSSIONS: SeedDiscussion[] = [
  {
    topic: 'AI 会取代初级程序员吗？',
    status: 'finished',
    base_time: '2026-11-10T09:00:00.000Z',
    started_at: '2026-11-10T09:01:00.000Z',
    finished_at: '2026-11-10T09:12:00.000Z',
    summary_text:
      '本场讨论围绕 AI 是否会取代初级程序员展开。多数嘉宾认为，重复性的编码工作会被快速替代，但需求理解、系统设计与跨团队沟通仍是人类的核心价值。分歧集中在时间尺度上：一方判断三到五年内初级岗位会明显收缩，另一方认为企业采用受合规与成本限制，岗位会转型而不是消失。共识是，初级工程师应尽早把 AI 当作协作者，把精力转向问题定义与质量把关。主持人建议，与其争论替代与否，不如现在开始积累可验证的工程判断力。',
    guests: [
      { name: '周慕之', profession: '圆桌主持人', stance: '中立梳理各方观点', color_id: 'amber', role: 'host', speaking_order: 0 },
      { name: '林知远', profession: '资深架构师', stance: '初级岗位会明显收缩', color_id: 'rose', role: 'expert', speaking_order: 1 },
      { name: '苏晚晴', profession: '产品经理', stance: '需求理解比写代码更稀缺', color_id: 'sky', role: 'expert', speaking_order: 2 },
      { name: '陈砚', profession: '高校讲师', stance: '教育应转向工程判断', color_id: 'emerald', role: 'expert', speaking_order: 3 },
      { name: '何川', profession: '创业公司 CTO', stance: '小团队更需要多面手', color_id: 'violet', role: 'expert', speaking_order: 4 },
    ],
    turns: [
      { speaker: 'host', speech_type: 'opening', content: '欢迎各位。今天讨论 AI 是否会取代初级程序员，请先给出判断，再说明理由。' },
      { speaker: 0, speech_type: 'challenge', content: '我认为会明显收缩。重复性的增删改查和简单接口开发，已经能被工具批量完成。' },
      { speaker: 1, speech_type: 'rebuttal', content: '我不同意只看代码量。需求澄清和跨团队对齐占了大半时间，这部分 AI 还接不住。' },
      { speaker: 2, speech_type: 'supplement', content: '补充一点，初级工程师的价值正在从写实现转向验证假设和阅读遗留系统。' },
      { speaker: 3, speech_type: 'challenge', content: '小团队的现实是，一个人要覆盖前后端。AI 提高下限，但也让招聘更谨慎。' },
      { speaker: 0, speech_type: 'supplement', content: '所以岗位不会消失，但入口会变窄，企业更愿意招能独立交付的人。' },
      { speaker: 1, speech_type: 'question', content: '如果入口变窄，新人去哪里积累判断力？这可能是更大的问题。' },
      { speaker: 2, speech_type: 'rebuttal', content: '教育可以补一部分，但真实项目里的取舍，课堂很难模拟。' },
      { speaker: 3, speech_type: 'supplement', content: '我建议新人先用 AI 做完整小项目，再带着结果去面试，比刷题更有说服力。' },
      {
        speaker: 'host',
        speech_type: 'summary',
        content:
          '本场讨论围绕 AI 是否会取代初级程序员展开。多数嘉宾认为，重复性的编码工作会被快速替代，但需求理解、系统设计与跨团队沟通仍是人类的核心价值。分歧集中在时间尺度上：一方判断三到五年内初级岗位会明显收缩，另一方认为企业采用受合规与成本限制，岗位会转型而不是消失。共识是，初级工程师应尽早把 AI 当作协作者，把精力转向问题定义与质量把关。主持人建议，与其争论替代与否，不如现在开始积累可验证的工程判断力。',
      },
    ],
    consensus: [
      { text: '重复性编码工作会最先被 AI 替代', support: [0, 3], round_no: 1 },
      { text: '需求理解与工程判断仍是人类核心价值', support: [1, 2, 3], round_no: 1 },
    ],
    divergence: [
      { text: '初级岗位会大幅收缩还是转型扩张', support: [0, 3], round_no: 1 },
      { text: '新人培养应靠真实项目还是课堂训练', support: [1, 2], round_no: 1 },
    ],
  },
  {
    topic: '远程办公是否降低团队效率？',
    status: 'finished',
    base_time: '2026-11-11T14:00:00.000Z',
    started_at: '2026-11-11T14:01:00.000Z',
    finished_at: '2026-11-11T14:14:00.000Z',
    summary_text:
      '本场讨论聚焦远程办公对效率与信任的影响。嘉宾普遍同意，远程并不天然降低效率，真正决定结果的是目标是否清晰、沟通是否同步。分歧在于新人培养：一方强调线下带教不可替代，另一方指出结构化文档与结对机制可以弥补距离。关于信任，讨论认为考核方式比办公地点更关键，按结果评估能显著减少形式主义。主持人总结，混合办公是更现实的落点，但需要明确会议边界、沉淀异步文档，并为新人设计固定的线下窗口。',
    guests: [
      { name: '沈一鸣', profession: '圆桌主持人', stance: '中立梳理各方观点', color_id: 'teal', role: 'host', speaking_order: 0 },
      { name: '顾清和', profession: '远程团队负责人', stance: '效率取决于目标清晰度', color_id: 'orange', role: 'expert', speaking_order: 1 },
      { name: '唐宁', profession: '组织心理学研究者', stance: '信任来自稳定交付', color_id: 'lime', role: 'expert', speaking_order: 2 },
      { name: '白鹭', profession: '新人培养教练', stance: '线下带教不可替代', color_id: 'indigo', role: 'expert', speaking_order: 3 },
      { name: '邵川', profession: '自由职业工程师', stance: '异步协作减少打断', color_id: 'fuchsia', role: 'expert', speaking_order: 4 },
    ],
    turns: [
      { speaker: 'host', speech_type: 'opening', content: '今天聊远程办公。请结合自己的团队经验，谈谈效率和信任的变化。' },
      { speaker: 0, speech_type: 'challenge', content: '远程不会天然降低效率。目标不清、会议过多，才是效率的真正杀手。' },
      { speaker: 1, speech_type: 'supplement', content: '信任来自稳定交付，而不是坐在同一间办公室。关键是考核方式要改。' },
      { speaker: 2, speech_type: 'rebuttal', content: '新人培养不能只看交付。线下的即时反馈和模仿学习，远程很难复制。' },
      { speaker: 3, speech_type: 'challenge', content: '异步协作反而减少了打断。我把深度工作放在上午，产出比在工位更高。' },
      { speaker: 0, speech_type: 'supplement', content: '但要给新人设计固定窗口，比如每周两天线下，否则融入会很慢。' },
      { speaker: 2, speech_type: 'question', content: '如果团队分布在不同城市，这个线下窗口的成本由谁承担？' },
      { speaker: 1, speech_type: 'supplement', content: '可以用季度集中办公替代每周通勤，既控制成本，也保留面对面。' },
      { speaker: 3, speech_type: 'rebuttal', content: '集中办公容易变成连续开会。我更在意的是会议边界和文档沉淀。' },
      { speaker: 0, speech_type: 'supplement', content: '结论是混合办公，但必须明确哪些事同步、哪些事异步。' },
      {
        speaker: 'host',
        speech_type: 'summary',
        content:
          '本场讨论聚焦远程办公对效率与信任的影响。嘉宾普遍同意，远程并不天然降低效率，真正决定结果的是目标是否清晰、沟通是否同步。分歧在于新人培养：一方强调线下带教不可替代，另一方指出结构化文档与结对机制可以弥补距离。关于信任，讨论认为考核方式比办公地点更关键，按结果评估能显著减少形式主义。主持人总结，混合办公是更现实的落点，但需要明确会议边界、沉淀异步文档，并为新人设计固定的线下窗口。',
      },
    ],
    consensus: [
      { text: '远程效率取决于目标与沟通是否清晰', support: [0, 1, 3], round_no: 1 },
      { text: '按结果考核比按工位考核更有效', support: [0, 1], round_no: 1 },
    ],
    divergence: [
      { text: '新人培养能否脱离线下带教', support: [2, 3], round_no: 1 },
      { text: '集中办公与每周通勤哪个成本更低', support: [0, 2], round_no: 1 },
    ],
  },
  {
    topic: '大学是否应该把编程课设为必修？',
    status: 'finished',
    base_time: '2026-11-12T10:00:00.000Z',
    started_at: '2026-11-12T10:01:00.000Z',
    finished_at: '2026-11-12T10:11:00.000Z',
    summary_text:
      '本场讨论围绕编程课是否应成为大学必修展开。多数嘉宾认同编程训练的是问题拆解能力，对非计算机专业同样有价值，分歧集中在落地条件上：一方强调师资与课时是硬约束，缺乏合格教师时强制开课只会流于形式；另一方主张先从计算思维入手、分层教学，把具体语言留作选修。关于考核，讨论提出应以小项目替代语法题，并允许不同专业选择不同题目。主持人总结，全面必修的条件尚不成熟，更现实的路径是先做两届试点，用学生能力数据再决定是否推广。',
    guests: [
      { name: '罗嘉', profession: '圆桌主持人', stance: '中立梳理各方观点', color_id: 'amber', role: 'host', speaking_order: 0 },
      { name: '韩梅', profession: '中学信息教师', stance: '编程应成为通识', color_id: 'rose', role: 'expert', speaking_order: 1 },
      { name: '杜衡', profession: '教育政策研究者', stance: '师资与课时是硬约束', color_id: 'sky', role: 'expert', speaking_order: 2 },
      { name: '谢南', profession: '算法工程师', stance: '早学编程有利思维训练', color_id: 'emerald', role: 'expert', speaking_order: 3 },
      { name: '程蔚', profession: '大学辅导员', stance: '兴趣分化不应被强制', color_id: 'violet', role: 'expert', speaking_order: 4 },
    ],
    turns: [
      { speaker: 'host', speech_type: 'opening', content: '今天讨论编程课是否应成为大学必修。请分别从教学目标和学生差异说起。' },
      { speaker: 0, speech_type: 'challenge', content: '我支持必修。编程训练的是把问题拆成步骤，这种能力对所有专业都有用。' },
      { speaker: 1, speech_type: 'rebuttal', content: '方向没错，但师资从哪来？很多学校连合格的信息课教师都凑不齐。' },
      { speaker: 2, speech_type: 'supplement', content: '补充一个角度，早接触编程能降低对技术的恐惧，这比掌握语法更重要。' },
      { speaker: 3, speech_type: 'challenge', content: '我担心强制会适得其反。文科生的兴趣和节奏不同，一刀切容易劝退。' },
      { speaker: 0, speech_type: 'supplement', content: '可以分层教学，必修的是计算思维，选修的才是具体语言和项目。' },
      { speaker: 1, speech_type: 'question', content: '分层之后如何考核？如果标准不统一，最后还是会变成刷题。' },
      { speaker: 2, speech_type: 'rebuttal', content: '考核可以看小项目，而不是语法题。关键是允许不同专业选不同题目。' },
      { speaker: 3, speech_type: 'supplement', content: '我同意先做试点，用两届学生的数据再决定是否全面必修。' },
      {
        speaker: 'host',
        speech_type: 'summary',
        content:
          '本场讨论围绕编程课是否应成为大学必修展开。多数嘉宾认同编程训练的是问题拆解能力，对非计算机专业同样有价值，分歧集中在落地条件上：一方强调师资与课时是硬约束，缺乏合格教师时强制开课只会流于形式；另一方主张先从计算思维入手、分层教学，把具体语言留作选修。关于考核，讨论提出应以小项目替代语法题，并允许不同专业选择不同题目。主持人总结，全面必修的条件尚不成熟，更现实的路径是先做两届试点，用学生能力数据再决定是否推广。',
      },
    ],
    consensus: [
      { text: '编程课有助于培养结构化思维', support: [0, 2], round_no: 1 },
      { text: '师资和课时是落地的硬约束', support: [1, 3], round_no: 1 },
    ],
    divergence: [
      { text: '编程应设为必修还是选修', support: [0, 3], round_no: 1 },
      { text: '低龄阶段先学编程还是先学数学', support: [1, 2], round_no: 1 },
    ],
  },
  {
    topic: '短视频对青少年注意力有何影响？',
    status: 'ready',
    base_time: '2026-11-13T16:00:00.000Z',
    started_at: null,
    finished_at: null,
    summary_text: null,
    guests: [
      { name: '江临', profession: '圆桌主持人', stance: '中立梳理各方观点', color_id: 'teal', role: 'host', speaking_order: 0 },
      { name: '吴桐', profession: '注意力研究员', stance: '短视频削弱持续专注', color_id: 'orange', role: 'expert', speaking_order: 1 },
      { name: '郑野', profession: '内容创作者', stance: '平台机制才是关键', color_id: 'lime', role: 'expert', speaking_order: 2 },
      { name: '梁清', profession: '中学班主任', stance: '家庭规则比禁手机有效', color_id: 'indigo', role: 'expert', speaking_order: 3 },
      { name: '许安', profession: '认知神经科学博士', stance: '影响被夸大但不可忽视', color_id: 'fuchsia', role: 'expert', speaking_order: 4 },
    ],
    // ready = 阵容已确认但尚未开始：0 条发言、0 条共识/分歧（data-model.md §6）
    turns: [],
    consensus: [],
    divergence: [],
  },
  {
    topic: '城市该不该全面禁售燃油车？',
    status: 'draft',
    base_time: '2026-11-14T08:00:00.000Z',
    started_at: null,
    finished_at: null,
    summary_text: null,
    guests: [
      { name: '温言', profession: '圆桌主持人', stance: '中立梳理各方观点', color_id: 'amber', role: 'host', speaking_order: 0 },
      { name: '赵启', profession: '汽车行业分析师', stance: '禁售需看基础设施', color_id: 'rose', role: 'expert', speaking_order: 1 },
      { name: '钱途', profession: '城市规划师', stance: '充电网络决定成败', color_id: 'sky', role: 'expert', speaking_order: 2 },
      { name: '孙然', profession: '环保律师', stance: '排放外部性必须内部化', color_id: 'emerald', role: 'expert', speaking_order: 3 },
      { name: '李澈', profession: '二手车商', stance: '过渡期会伤害低收入群体', color_id: 'violet', role: 'expert', speaking_order: 4 },
    ],
    // draft = 阵容待确认：locked=0、0 条发言、0 条共识/分歧、无 agent_status
    turns: [],
    consensus: [],
    divergence: [],
  },
];
