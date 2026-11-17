import type { ColorId } from '@ai-panel/shared';

/**
 * `color_id` → CSS 变量的**唯一**映射（docs/DESIGN.md §2.4）。
 *
 * 组件里禁止 `if (id === 'amber')`，也禁止维护第二份色表。
 * 三个后缀的含义见 DESIGN.md：-fg 前景 / -bg 底色 / -ring 描边与状态外圈。
 */

export interface ExpertColorStyle {
  readonly '--expert-fg': string;
  readonly '--expert-bg': string;
  readonly '--expert-ring': string;
  /** 让 Vue 的 StyleValue（CSSProperties）接受这组自定义属性 */
  readonly [key: `--${string}`]: string;
}

const FALLBACK: ExpertColorStyle = {
  '--expert-fg': 'var(--fg-muted)',
  '--expert-bg': 'var(--bg-raised)',
  '--expert-ring': 'var(--line-strong)',
};

const VARIABLE_BY_ID: Record<ColorId, ExpertColorStyle> = {
  amber: {
    '--expert-fg': 'var(--c-amber-fg)',
    '--expert-bg': 'var(--c-amber-bg)',
    '--expert-ring': 'var(--c-amber-ring)',
  },
  rose: {
    '--expert-fg': 'var(--c-rose-fg)',
    '--expert-bg': 'var(--c-rose-bg)',
    '--expert-ring': 'var(--c-rose-ring)',
  },
  sky: {
    '--expert-fg': 'var(--c-sky-fg)',
    '--expert-bg': 'var(--c-sky-bg)',
    '--expert-ring': 'var(--c-sky-ring)',
  },
  emerald: {
    '--expert-fg': 'var(--c-emerald-fg)',
    '--expert-bg': 'var(--c-emerald-bg)',
    '--expert-ring': 'var(--c-emerald-ring)',
  },
  violet: {
    '--expert-fg': 'var(--c-violet-fg)',
    '--expert-bg': 'var(--c-violet-bg)',
    '--expert-ring': 'var(--c-violet-ring)',
  },
  orange: {
    '--expert-fg': 'var(--c-orange-fg)',
    '--expert-bg': 'var(--c-orange-bg)',
    '--expert-ring': 'var(--c-orange-ring)',
  },
  teal: {
    '--expert-fg': 'var(--c-teal-fg)',
    '--expert-bg': 'var(--c-teal-bg)',
    '--expert-ring': 'var(--c-teal-ring)',
  },
  lime: {
    '--expert-fg': 'var(--c-lime-fg)',
    '--expert-bg': 'var(--c-lime-bg)',
    '--expert-ring': 'var(--c-lime-ring)',
  },
  indigo: {
    '--expert-fg': 'var(--c-indigo-fg)',
    '--expert-bg': 'var(--c-indigo-bg)',
    '--expert-ring': 'var(--c-indigo-ring)',
  },
  fuchsia: {
    '--expert-fg': 'var(--c-fuchsia-fg)',
    '--expert-bg': 'var(--c-fuchsia-bg)',
    '--expert-ring': 'var(--c-fuchsia-ring)',
  },
};

function isColorId(value: string): value is ColorId {
  return value in VARIABLE_BY_ID;
}

/**
 * 接受 `string` 而不是 `ColorId`：DB 里读出来的可能是脏值，
 * 脏值降级为中性灰，不抛错（渲染层不该因为一个颜色崩掉）。
 */
export function expertColorStyle(id: string): ExpertColorStyle {
  return isColorId(id) ? VARIABLE_BY_ID[id] : FALLBACK;
}
