import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { config } from '../config';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// Browser lifecycle — setup and teardown
// Ensures browser is always cleaned up regardless of how the bot exits
// ---------------------------------------------------------------------------

export interface BrowserHandle {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function launchBrowser(): Promise<BrowserHandle> {
  const browser = await chromium.launch({
    headless: config.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });

  // Mask automation signals
  await context.addInitScript(() => {
    Object.defineProperty((globalThis as any).navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(config.stepTimeout);
  page.setDefaultNavigationTimeout(config.stepTimeout);

  logger.debug('Browser launched');
  return { browser, context, page };
}

export async function closeBrowser(handle: BrowserHandle | null): Promise<void> {
  if (!handle) return;
  try {
    await handle.context.close();
    await handle.browser.close();
    logger.debug('Browser closed');
  } catch (err) {
    logger.warn({ err }, 'Error closing browser (ignored)');
  }
}

/** Take a screenshot and return base64 PNG */
export async function screenshot(page: Page, clip?: { x: number; y: number; width: number; height: number }): Promise<string> {
  const buf = await page.screenshot({ type: 'png', clip });
  return buf.toString('base64');
}
