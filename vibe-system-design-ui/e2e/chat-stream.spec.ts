import { test, expect } from '@playwright/test';

test.describe('Chat Stream E2E with Mocked SSE', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log(`[BROWSER CONSOLE] ${msg.text()}`));
    page.on('pageerror', (err) => console.error(`[BROWSER ERROR] ${err.message}`));

    // Mock sessions collection endpoint (GET list, POST create)
    await page.route('**/v1/chat/sessions', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/v1/chat/sessions') {
        const method = route.request().method();
        if (method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ sessions: [] }),
          });
          return;
        }
        if (method === 'POST') {
          const now = Date.now();
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              session: {
                id: 'ses_mock123',
                title: 'New Session',
                createdAt: now,
                updatedAt: now,
                lastMessageAt: null,
              },
            }),
          });
          return;
        }
      }
      await route.continue();
    });

    // Mock individual session endpoint
    await page.route('**/v1/chat/sessions/ses_mock123', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/v1/chat/sessions/ses_mock123') {
        const now = Date.now();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session: {
              id: 'ses_mock123',
              title: 'New Session',
              createdAt: now,
              updatedAt: now,
              lastMessageAt: null,
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    // Mock session messages endpoint
    await page.route('**/v1/chat/sessions/ses_mock123/messages', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/v1/chat/sessions/ses_mock123/messages') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ messages: [] }),
        });
        return;
      }
      await route.continue();
    });

    // Mock the SSE stream endpoint
    await page.route('**/v1/chat/stream', async (route) => {
      const sseBody = [
        `data: ${JSON.stringify({ type: 'event', seq: 1, method: 'messages', params: { namespace: [], timestamp: Date.now(), data: { event: 'message-start', id: 'm-1', role: 'ai' } } })}\n\n`,
        `data: ${JSON.stringify({ type: 'event', seq: 2, method: 'messages', params: { namespace: [], timestamp: Date.now(), data: { event: 'content-block-delta', index: 0, delta: { type: 'text-delta', text: 'Hello from Playwright SSE mock!' } } } })}\n\n`,
        `event: done\ndata: {}\n\n`,
      ].join('');

      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
        body: sseBody,
      });
    });

    await page.goto('/');
  });

  test('user can send message and receive streamed AI response', async ({ page }) => {
    const input = page.locator('textarea[aria-label="Composer"], input[aria-label="Composer"], .aui-composer__input').first();
    await expect(input).toBeEnabled({ timeout: 10000 });

    await input.fill('What is enterprise AI testing?');
    await input.press('Enter');

    await expect(page.locator('text=Hello from Playwright SSE mock!')).toBeVisible({ timeout: 10000 });
  });
});
