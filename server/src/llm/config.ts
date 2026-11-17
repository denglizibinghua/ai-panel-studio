/**
 * 全仓库唯一读取模型凭据的位置（AGENTS.md §6.1 / H5）。
 *
 * 其他任何文件（包括 app.ts 的 /health）都只能通过这里判断配置状态，
 * 不得直接读 `process.env.DEEPSEEK_API_KEY` —— 否则「Key 只在 llm/ 内」这条不变量
 * 会从边角被侵蚀，最终没人说得清 Key 到底在几个地方被读到。
 */

export function getLlmApiKey(): string | null {
  const key = process.env.DEEPSEEK_API_KEY;
  if (typeof key !== 'string') {
    return null;
  }
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isLlmConfigured(): boolean {
  return getLlmApiKey() !== null;
}

/**
 * 实际服务模型名。`deepseek-chat` 已经下线，Pro 档目前由 `deepseek-flash` 承接，
 * 所以默认值就是 flash，并允许用 `DEEPSEEK_MODEL` 覆盖（换账号 / 换档位时不用改代码）。
 * 落库时以**响应里返回的 model 为准**（见 client.ts），这样服务端改名不会骗过审计表。
 */
const DEFAULT_MODEL = 'deepseek-flash';

export function getLlmModel(): string {
  const model = process.env.DEEPSEEK_MODEL;
  if (typeof model === 'string' && model.trim().length > 0) {
    return model.trim();
  }
  return DEFAULT_MODEL;
}
