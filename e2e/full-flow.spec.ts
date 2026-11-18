import { expect, test } from '@playwright/test';
import {
  discussionIdFromUrl,
  installSpeakingWatcher,
  sawSpeaking,
  shot,
} from './helpers';

/**
 * S10 主链路（SESSION_MAP §S10，一条用例，不是四个小用例）。
 *
 * 同一个 context 走完全程：`sessionId` 存在 localStorage，AC-3.8 靠它把确认页
 * 与演播厅的写入口留给创建者。切 context 会得到「按钮找不到」，而不是权限报错。
 *
 * 断言口径（S9 之后的增量）：
 * - 总结不在 transcript 里，长度取 `.summary-panel__text` 的正文，不数条数；
 * - 种子场次 `session_id=NULL`，对任何浏览器只读，所以必须「发起新讨论」；
 * - 小屏（390）用 `scrollHeight` 判断滚动而不是裁切，不拿面板高度猜。
 */
test('完整链路：首页分组 → 新建 → 确认阵容 → 演播厅 → 总结', async ({ page, request }) => {
  // health preflight: 后端没起来时立刻说清楚，而不是等 20s 后看一屏 UI 报错。
  const health = await request.get('/health');
  expect(health.ok(), `后端未就绪: HTTP ${health.status()}`).toBe(true);

  await installSpeakingWatcher(page);

  const topic = `E2E 全链路：AI 是否应当接管代码评审 ${Date.now()}`;

  /* 1. 首页：样例讨论分组 */
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '讨论', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '进行中', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '已结束', level: 2 })).toBeVisible();
  await expect(page.locator('.dcard').first()).toBeVisible();
  await shot(page, '01-home');

  /* 2. 新建讨论：议题 + 专家数 4 */
  await page.getByRole('button', { name: '发起新讨论' }).click();
  await expect(page.getByLabel('议题')).toBeVisible();
  await expect(page.locator('.app-stepper__value')).toHaveText('4');
  await page.getByLabel('议题').fill(topic);
  await page.getByRole('button', { name: '生成嘉宾' }).click();

  /* 3. 确认页：5 张卡片，每张都有姓名 / 职业 / 立场 / 色块 */
  await expect(page).toHaveURL(/\/discussions\/\d+\/guests$/);
  const cards = page.locator('.guest-card');
  await expect(cards).toHaveCount(5);
  for (let index = 0; index < 5; index += 1) {
    const card = cards.nth(index);
    await expect(card.locator('.guest-card__name')).not.toBeEmpty();
    await expect(card.locator('.guest-card__profession')).not.toBeEmpty();
    await expect(card.locator('.guest-card__stance')).not.toBeEmpty();
    // 色块只走 expertColorStyle()：卡片内联变量一旦缺失，专家色就整列变灰。
    await expect(card).toHaveAttribute('style', /--expert/);
  }
  await shot(page, '02-guest-confirm');

  /* 4. 确认并开始，进入演播厅 */
  await page.getByRole('button', { name: '确认进入演播厅' }).click();
  await expect(page).toHaveURL(/\/discussions\/\d+\/theater$/);
  const discussionId = discussionIdFromUrl(page.url());
  await expect(page.locator('.transcript-feed')).toBeVisible();

  /* 5. 等待主持人开场 + 专家发言陆续出现（至少 6 条，每条都有发言人名） */
  const items = page.locator('.transcript-feed .transcript-item');
  await expect
    .poll(async () => items.count(), { message: 'transcript 至少 6 条' })
    .toBeGreaterThanOrEqual(6);
  const names = await page.locator('.transcript-item__name').allInnerTexts();
  expect(names.length).toBeGreaterThanOrEqual(6);
  for (const name of names) {
    expect(name.trim().length).toBeGreaterThan(0);
  }
  await shot(page, '03-theater-live');

  /* 6. 专家状态徽章至少出现过一次「发言中」 */
  await expect
    .poll(async () => sawSpeaking(page), { message: '应出现过一次 speaking 徽章' })
    .toBe(true);

  /* 7. 讨论结束 → 总结面板出现，正文 > 50 字 */
  const summary = page.locator('.summary-panel__text');
  await expect(summary).toBeVisible();
  const summaryText = (await summary.innerText()).trim();
  expect(summaryText.length).toBeGreaterThan(50);
  await expect(page.locator('.host-bar')).toContainText('已结束');
  await shot(page, '04-summary');

  /* 8. 页面上不得出现原始 JSON（含 Vue 转义后的形态） */
  const html = await page.content();
  for (const needle of [
    '"reason":',
    '"type":"',
    '&quot;reason&quot;:',
    '&quot;type&quot;:&quot;',
  ]) {
    expect(html, `页面不应出现原始 JSON 片段 ${needle}`).not.toContain(needle);
  }
  expect(summaryText).not.toContain('{');

  /* 9. 小屏：总结面板内部可滚（scrollHeight 判定，不拿面板高度猜） */
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(summary).toBeVisible();
  const metrics = await page.evaluate(() => {
    const body = document.querySelector('.summary-panel .app-panel__body');
    if (!(body instanceof HTMLElement)) {
      return null;
    }
    return {
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      overflowY: getComputedStyle(body).overflowY,
    };
  });
  expect(metrics).not.toBeNull();
  expect(metrics?.overflowY).toBe('auto');
  expect(metrics?.scrollHeight ?? 0).toBeGreaterThan(metrics?.clientHeight ?? 0);

  // 滚到底：证明正文没有被面板裁掉，只是需要滚动（比「看到一截字」可靠）。
  const reachesEnd = await page.evaluate(() => {
    const body = document.querySelector('.summary-panel .app-panel__body');
    if (!(body instanceof HTMLElement)) {
      return false;
    }
    body.scrollTop = body.scrollHeight;
    return body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
  });
  expect(reachesEnd).toBe(true);
  await shot(page, '05-summary-390');

  /* 10. 落库口径与 UI 一致（INV-9 的两个副本） */
  const detail = await page.request.get(`/api/discussions/${discussionId}`);
  expect(detail.ok()).toBe(true);
  const body = (await detail.json()) as {
    status: string;
    summary_text: string | null;
    error_code: string | null;
  };
  expect(body.status).toBe('finished');
  expect(body.error_code).toBeNull();
  expect(body.summary_text).toBe(summaryText);
});
