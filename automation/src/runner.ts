import { Page } from 'playwright';
import { StateMachine } from './state-machine';
import { WebhookClient, infoEvent, warnEvent, errorEvent } from './webhook-client';
import { launchBrowser, closeBrowser, screenshot, BrowserHandle } from './browser';
import { config } from './config';
import { encrypt } from './crypto';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Main automation runner
// Drives the Income-Tax e-filing portal "Forgot Password" flow:
//   Navigate → Enter User ID (PAN) → Solve CAPTCHA → Choose Aadhaar OTP
//   → Enter OTP → Set new password → Done
// ---------------------------------------------------------------------------

const PORTAL_URL     = config.portalUrl;
const SERVICE_URL    = config.serviceUrl;
const WEBHOOK_SECRET = config.webhookSecret;

export async function run(jobId: string, pan: string): Promise<void> {
  const fsm    = new StateMachine(jobId, 'IDLE');
  const hook   = new WebhookClient(jobId);
  let   handle: BrowserHandle | null = null;

  try {
    // -----------------------------------------------------------------------
    // PHASE: NAVIGATING
    // -----------------------------------------------------------------------
    let t = fsm.transition('NAVIGATING');
    await hook.send(infoEvent('NAVIGATING', 'BROWSER_LAUNCH', 'Launching browser'), { phaseTransition: t });

    handle = await launchBrowser();
    const { page } = handle;

    await hook.send(infoEvent('NAVIGATING', 'NAVIGATE_TO_PORTAL', `Navigating to IT portal`));
    await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded' });

    // Click Login button
    await hook.send(infoEvent('NAVIGATING', 'CLICK_LOGIN', 'Clicking Login button'));
    await page.click('a[href*="login"], button:has-text("Login")', { timeout: 15000 });
    await page.waitForLoadState('domcontentloaded');

    // Enter User ID (PAN)
    await hook.send(infoEvent('NAVIGATING', 'ENTER_USER_ID', `Entering User ID (PAN masked)`));
    const userIdInput = page.locator('input[formcontrolname="userId"], input[name="userId"], input#userId, input#panAdhaarUserId').first();
    await userIdInput.fill(pan);

    // Click Continue
    await page.click('button:has-text("Continue"), button[type="submit"]');
    await page.waitForLoadState('domcontentloaded');

    // Check for invalid PAN error message before proceeding
    const loginError = await page.locator('.error-message, .alert-danger, [class*="error"], p:has-text("PAN does not exist")').first().textContent({ timeout: 3000 }).catch(() => null);
    if (loginError && loginError.toLowerCase().includes('does not exist')) {
      throw new Error(`Invalid PAN: ${loginError.trim().replace(/\\s+/g, ' ')}`);
    }

    // Click "Forgot Password?"
    await hook.send(infoEvent('NAVIGATING', 'CLICK_FORGOT_PASSWORD', 'Clicking Forgot Password'));
    await page.click('a:has-text("Forgot Password"), span:has-text("Forgot Password")');
    await page.waitForLoadState('domcontentloaded');

    // -----------------------------------------------------------------------
    // PHASE: CAPTCHA
    // -----------------------------------------------------------------------
    t = fsm.transition('CAPTCHA');
    await hook.send(infoEvent('CAPTCHA', 'CAPTCHA_PHASE_START', 'CAPTCHA phase started'), { phaseTransition: t });

    await solveCaptchaWithRetry(page, jobId, hook, fsm);

    // -----------------------------------------------------------------------
    // PHASE: FILLING_DETAILS
    // -----------------------------------------------------------------------
    t = fsm.transition('FILLING_DETAILS');
    await hook.send(infoEvent('FILLING_DETAILS', 'FILLING_DETAILS_START', 'Selecting OTP method'), { phaseTransition: t });

    // Select "OTP on mobile number registered with Aadhaar"
    try {
      await page.click('input[value="aadhaarOtp"], label:has-text("Aadhaar OTP"), input[id*="aadhaar"]', { timeout: 10000 });
    } catch {
      // Try selecting by visible text
      await page.getByText('OTP on mobile number registered with Aadhaar').click({ timeout: 10000 });
    }

    // Check declaration checkbox if present
    try {
      const checkbox = page.locator('input[type="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 3000 })) {
        await checkbox.check();
        await hook.send(infoEvent('FILLING_DETAILS', 'DECLARATION_CHECKED', 'Aadhaar declaration checkbox checked'));
      }
    } catch { /* checkbox may not be present */ }

    await hook.send(infoEvent('FILLING_DETAILS', 'CLICK_GENERATE_OTP', 'Clicking Generate OTP'));
    await page.click('button:has-text("Generate OTP"), button:has-text("Continue"), button[type="submit"]');

    // -----------------------------------------------------------------------
    // PHASE: WAITING_FOR_OTP
    // -----------------------------------------------------------------------
    t = fsm.transition('WAITING_FOR_OTP');
    await hook.send(
      infoEvent('WAITING_FOR_OTP', 'OTP_REQUESTED', 'OTP sent to Aadhaar-linked mobile. Waiting for operator to enter OTP.'),
      { phaseTransition: t }
    );

    // OTP retry loop (wrong OTP up to 3 attempts)
    let otpSuccess = false;
    let otpAttempts = 0;
    const MAX_OTP_ATTEMPTS = 3;

    while (!otpSuccess && otpAttempts < MAX_OTP_ATTEMPTS) {
      // Poll service for OTP submitted by operator
      const otp = await pollForOtp(jobId, hook);

      // Transition to SUBMITTING_OTP
      t = fsm.transition('SUBMITTING_OTP');
      await hook.send(
        infoEvent('SUBMITTING_OTP', 'OTP_RECEIVED', `OTP received from operator (attempt ${otpAttempts + 1}/${MAX_OTP_ATTEMPTS})`),
        { phaseTransition: t }
      );

      // Fill OTP field
      const otpInput = page.locator('input[formcontrolname="otp"], input[name="otp"], input#otp, input[placeholder*="OTP"]').first();
      await otpInput.fill(otp);

      await page.click('button:has-text("Validate"), button:has-text("Verify"), button:has-text("Continue"), button[type="submit"]');
      await page.waitForTimeout(2000);

      // Check for error
      const errorMsg = await page.locator('.error-message, .alert-danger, [class*="error"]').textContent({ timeout: 5000 }).catch(() => null);

      if (errorMsg && errorMsg.toLowerCase().includes('invalid')) {
        otpAttempts++;
        await hook.send(warnEvent('SUBMITTING_OTP', 'OTP_INVALID', `Invalid OTP (attempt ${otpAttempts}/${MAX_OTP_ATTEMPTS}). ${otpAttempts < MAX_OTP_ATTEMPTS ? 'Waiting for new OTP.' : 'Max attempts reached.'}`));

        if (otpAttempts >= MAX_OTP_ATTEMPTS) {
          throw new Error(`OTP validation failed after ${MAX_OTP_ATTEMPTS} attempts`);
        }

        // Back to WAITING_FOR_OTP for retry
        t = fsm.transition('WAITING_FOR_OTP');
        await hook.send(
          infoEvent('WAITING_FOR_OTP', 'OTP_RETRY', 'Waiting for correct OTP from operator'),
          { phaseTransition: t }
        );
      } else {
        otpSuccess = true;
      }
    }

    // -----------------------------------------------------------------------
    // PHASE: SETTING_PASSWORD
    // -----------------------------------------------------------------------
    t = fsm.transition('SETTING_PASSWORD');
    await hook.send(infoEvent('SETTING_PASSWORD', 'PASSWORD_PHASE_START', 'Setting new password'), { phaseTransition: t });

    const newPassword = generateStrongPassword();

    // Fill new password fields
    const pwdField    = page.locator('input[formcontrolname="newPassword"], input[name="newPassword"], input#newPassword').first();
    const confirmPwd  = page.locator('input[formcontrolname="confirmPassword"], input[name="confirmPassword"], input#confirmPassword').first();

    await pwdField.fill(newPassword);
    await confirmPwd.fill(newPassword);

    // Set personalized message if required
    try {
      const msgField = page.locator('input[formcontrolname="personalMessage"], input[placeholder*="message"]').first();
      if (await msgField.isVisible({ timeout: 3000 })) {
        await msgField.fill('My secure login message');
      }
    } catch { /* field may not exist */ }

    await hook.send(infoEvent('SETTING_PASSWORD', 'PASSWORD_SUBMIT', 'Submitting new password'));
    await page.click('button:has-text("Submit"), button:has-text("Register"), button[type="submit"]');
    await page.waitForLoadState('domcontentloaded');

    // Check for success confirmation
    await page.waitForSelector(
      'text=successfully, text=Success, .success, [class*="success"]',
      { timeout: 15000 }
    );

    // Encrypt credentials before sending
    const encryptedUserId   = encrypt(pan);   // PAN is the User ID on IT portal
    const encryptedPassword = encrypt(newPassword);

    // -----------------------------------------------------------------------
    // PHASE: DONE
    // -----------------------------------------------------------------------
    t = fsm.transition('DONE');
    await hook.send(
      infoEvent('DONE', 'JOB_COMPLETE', 'Credentials generated successfully. Credentials saved (encrypted).'),
      {
        phaseTransition: t,
        outcome: 'success',
        credentials: { userId: encryptedUserId, password: encryptedPassword },
      }
    );

    logger.info({ jobId }, 'Automation completed successfully');

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ jobId, err }, 'Automation failed');

    // Capture failure screenshot
    let screenshotB64: string | undefined;
    if (handle?.page) {
      screenshotB64 = await screenshot(handle.page).catch(() => undefined);
    }

    // Transition to FAILED from wherever we are
    if (!fsm.isTerminal()) {
      try {
        fsm.transition('FAILED');
      } catch { /* if FAILED not reachable, ignore */ }
    }

    await hook.send(
      errorEvent('FAILED', 'JOB_FAILED', `Automation failed: ${message}`, {
        screenshot: screenshotB64 ? `data:image/png;base64,${screenshotB64}` : undefined,
      }),
      {
        phaseTransition: { from: fsm.phase, to: 'FAILED' },
        outcome: 'failure',
      }
    );

  } finally {
    await closeBrowser(handle);
  }
}

// ---------------------------------------------------------------------------
// CAPTCHA handling — screenshot → send to UI → wait for operator solution
// ---------------------------------------------------------------------------

async function solveCaptchaWithRetry(
  page: Page,
  jobId: string,
  hook: WebhookClient,
  _fsm: StateMachine
): Promise<void> {
  for (let attempt = 0; attempt < config.captchaPollMaxAttempts; attempt++) {
    // Take screenshot of CAPTCHA element
    const captchaEl = page.locator('img[src*="captcha"], canvas#captcha, #captchaImage, img.captcha-img').first();
    let captchaScreenshot: string | undefined;

    try {
      const box = await captchaEl.boundingBox();
      if (box) {
        captchaScreenshot = await screenshot(page, box);
      } else {
        captchaScreenshot = await screenshot(page);
      }
    } catch {
      captchaScreenshot = await screenshot(page);
    }

    await hook.send(infoEvent(
      'CAPTCHA',
      'CAPTCHA_SCREENSHOT',
      'CAPTCHA image captured. Waiting for operator to enter solution.',
      { captchaImage: `data:image/png;base64,${captchaScreenshot}` }
    ));

    // Poll service for captcha solution
    const solution = await pollForCaptcha(jobId, hook);

    // Fill captcha
    const captchaInput = page.locator(
      'input[formcontrolname="captcha"], input[name="captcha"], input#captcha, input[placeholder*="captcha" i]'
    ).first();
    await captchaInput.fill(solution);

    await page.click('button:has-text("Continue"), button:has-text("Validate"), button[type="submit"]');
    await page.waitForTimeout(2000);

    // Check if captcha was wrong
    const err = await page.locator('.error-message, .alert-danger, [class*="error"]').textContent({ timeout: 3000 }).catch(() => null);
    if (err && (err.toLowerCase().includes('captcha') || err.toLowerCase().includes('invalid'))) {
      await hook.send(warnEvent('CAPTCHA', 'CAPTCHA_RETRY', `Invalid CAPTCHA, attempt ${attempt + 1}. Retrying.`));
      continue;
    }

    await hook.send(infoEvent('CAPTCHA', 'CAPTCHA_SOLVED', 'CAPTCHA accepted'));
    return;
  }

  throw new Error('CAPTCHA could not be solved after maximum attempts');
}

// ---------------------------------------------------------------------------
// Poll service for OTP / CAPTCHA (long-poll simulation with retries)
// ---------------------------------------------------------------------------

async function pollForOtp(jobId: string, hook: WebhookClient): Promise<string> {
  const url = `${SERVICE_URL}/jobs/${jobId}/otp-poll`;

  for (let i = 0; i < config.otpPollMaxAttempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'X-Webhook-Secret': WEBHOOK_SECRET,
        },
      });

      if (res.ok) {
        const data = await res.json() as { otp?: string };
        if (data.otp) return data.otp;
      }
    } catch { /* network hiccup, retry */ }

    if (i % 6 === 0) { // every 30s
      await hook.send(infoEvent('WAITING_FOR_OTP', 'OTP_STILL_WAITING', 'Still waiting for OTP from operator...'));
    }

    await sleep(5000);
  }

  throw new Error('OTP not received within timeout');
}

async function pollForCaptcha(jobId: string, hook: WebhookClient): Promise<string> {
  const url = `${SERVICE_URL}/jobs/${jobId}/captcha-poll`;

  for (let i = 0; i < config.captchaPollMaxAttempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'X-Webhook-Secret': WEBHOOK_SECRET,
        },
      });

      if (res.ok) {
        const data = await res.json() as { captcha?: string };
        if (data.captcha) return data.captcha;
      }
    } catch { /* retry */ }

    if (i % 4 === 0) {
      await hook.send(infoEvent('CAPTCHA', 'CAPTCHA_STILL_WAITING', 'Waiting for operator to enter CAPTCHA...'));
    }

    await sleep(5000);
  }

  throw new Error('CAPTCHA solution not received within timeout');
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function generateStrongPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let pwd = '';
  // Ensure complexity: 1 uppercase, 1 lowercase, 1 digit, 1 special
  pwd += 'A'; // uppercase
  pwd += 'a'; // lowercase
  pwd += '2'; // digit
  pwd += '!'; // special
  for (let i = 4; i < 12; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Shuffle
  return pwd.split('').sort(() => Math.random() - 0.5).join('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
