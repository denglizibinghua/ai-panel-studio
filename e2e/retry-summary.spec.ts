import { expect, test } from '@playwright/test';
import { discussionIdFromUrl, readEventLog, shot } from './helpers';

/**
 * S10 增量 3：retry-summary 的 E2E 必须自己造失败。
 *
 * fake 对议题里带 `#fail-turn` 的讨论把**专家发言**全部打挂（主持人开场保留，
 * 否则 transcript 为空，retry 会走 `empty_transcript` 分支，测不到
 * `reason='retry_summary'` —— 见 server/src/modules/discussion/retry.ts）。
 *
 * 结束态断言不看 UI 文案下结论：`run.finished.reason` 与 summary 那一行的正文
 * 只能从 `events` 重放里拿到（详情接口不含 turns）。
 */
test('失败链路：ALL_SPEAKERS_FAILED → 重新生成总结 → retry_summary', async ({ page, request }) => {
  // health preflight: 后端没起来时立刻说清楚，而不是等 20s 后看一屏 UI 报错。
  const health = await request.get('/health');
  expect(health.ok(), `后端未就绪: HTTP ${health.status()}`).toBe(true);

  const topic = `E2E 失败链路：极端假设需要被证伪 ${Date.now()} #fail-turn`;

  await page.goto('/');
  await page.getByRole('button', { name: '发起新讨论' }).click();
  await page.getByLabel('议题').fill(topic);
  await page.getByRole('button', { name: '生成嘉宾' }).click();

  await expect(page).toHaveURL(/\/discussions\/\d+\/guests$/);
  await expect(page.locator('.guest-card')).toHaveCount(5);
  await page.getByRole('button', { name: '确认进入演播厅' }).click();

  await expect(page).toHaveURL(/\/discussions\/\d+\/theater$/);
  const discussionId = discussionIdFromUrl(page.url());

  /* 1. 跑到 failed：状态徽标 + 总结面板失败态 + 重试入口 */
  await expect(page.locator('.host-bar')).toContainText('失败');
  const retryButton = page.getByRole('button', { name: '重新生成总结' });
  await expect(retryButton).toBeVisible();
  await expect(page.locator('.summary-panel__text')).toHaveCount(0);
  await shot(page, '06-retry-failed');

  const failedDetail = (await (await page.request.get(`/api/discussions/${discussionId}`)).json()) as {
    status: string;
    error_code: string | null;
  };
  expect(failedDetail.status).toBe('failed');
  expect(failedDetail.error_code).toBe('ALL_SPEAKERS_FAILED');

  /* 2. 点「重新生成总结」→ finished + 自然语言总结 */
  await retryButton.click();
  const summary = page.locator('.summary-panel__text');
  await expect(summary).toBeVisible();
  const summaryText = (await summary.innerText()).trim();
  expect(summaryText.length).toBeGreaterThan(50);
  await expect(page.locator('.host-bar')).toContainText('已结束');
  await shot(page, '07-retry-summary');

  /* 3. 落库 + 事件双重取证 */
  const detail = (await (await page.request.get(`/api/discussions/${discussionId}`)).json()) as {
    status: string;
    error_code: string | null;
    summary_text: string | null;
  };
  expect(detail.status).toBe('finished');
  expect(detail.error_code).toBeNull();
  expect(detail.summary_text).toBe(summaryText);

  const frames = await readEventLog(discussionId);
  const finished = frames.filter((frame) => frame.type === 'run.finished').at(-1);
  expect(finished, 'run.finished 应存在').toBeDefined();
  const finishedPayload = JSON.parse(finished?.data ?? '{}') as { reason?: string };
  expect(finishedPayload.reason).toBe('retry_summary');

  const summaryTurns = frames.filter((frame) => frame.type === 'turn.done').filter((frame) => {
    const payload = JSON.parse(frame.data) as { speech_type?: string };
    return payload.speech_type === 'summary';
  });
  const lastSummaryTurn = summaryTurns.at(-1);
  expect(lastSummaryTurn, 'summary turn.done 应存在').toBeDefined();
  const turnPayload = JSON.parse(lastSummaryTurn?.data ?? '{}') as { content?: string };
  // INV-9: work `turns.content` 与 `discussions.summary_text` 逐字相等。
  expect(turnPayload.content).toBe(detail.summary_text);
  expect(turnPayload.content).toBe(summaryText);
});
