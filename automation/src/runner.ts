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

const PORTAL_URL = config.portalUrl;
const SERVICE_URL = config.serviceUrl;
const WEBHOOK_SECRET = config.webhookSecret;

export async function run(jobId: string, pan: string): Promise<void> {
  const fsm = new StateMachine(jobId, 'IDLE');
  const hook = new WebhookClient(jobId);
  let handle: BrowserHandle | null = null;

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

    // Wait for either the password page (success) or an error message (invalid PAN)
    const loginResult = await Promise.race([
      page.waitForSelector('mat-error, .error-message, .error-text', { state: 'visible', timeout: 15000 }).then(() => 'error'),
      page.waitForSelector('input[type="password"], a:has-text("Forgot Password"), span:has-text("Forgot Password")', { state: 'visible', timeout: 15000 }).then(() => 'success')
    ]).catch(() => 'timeout');

    if (loginResult === 'error') {
      const errorMsg = await page.locator('mat-error, .error-message, .error-text').first().textContent();
      throw new Error(`Invalid PAN: ${errorMsg?.trim() || 'User ID not found'}`);
    } else if (loginResult === 'timeout') {
      throw new Error('Timeout waiting for next step after entering PAN');
    }

    // Click "Forgot Password?"
    await hook.send(infoEvent('NAVIGATING', 'CLICK_FORGOT_PASSWORD', 'Clicking Forgot Password'));
    await page.click('a:has-text("Forgot Password"), span:has-text("Forgot Password")');
    await page.waitForLoadState('domcontentloaded');

    // On the Forgot Password page, we must enter the User ID again
    await hook.send(infoEvent('NAVIGATING', 'ENTER_USER_ID_AGAIN', `Entering User ID again for Forgot Password`));
    const forgotUserIdInput = page.locator('input[formcontrolname="userId"], input[name="userId"], input#userId, input#panAdhaarUserId').first();
    await forgotUserIdInput.waitFor({ state: 'visible', timeout: 15000 });
    // Clear any pre-filled value and type the PAN fresh
    await forgotUserIdInput.click({ clickCount: 3 }); // triple-click to select all
    await forgotUserIdInput.fill('');
    await page.waitForTimeout(500);
    await forgotUserIdInput.fill(pan);
    await page.waitForTimeout(800); // allow Angular validation to settle

    // Click Continue on Forgot Password page — use a robust locator that
    // waits for the button to be enabled before clicking
    await hook.send(infoEvent('NAVIGATING', 'CLICK_CONTINUE_FORGOT', 'Clicking Continue on Forgot Password page'));
    const continueBtn = page.locator(
      'button:has-text("Continue"), button[type="submit"]'
    ).first();
    // Wait until the button is visible AND enabled (Angular may keep it disabled until form is valid)
    await continueBtn.waitFor({ state: 'visible', timeout: 15000 });
    // Wait until the button is enabled (poll every 500ms, up to 10s)
    for (let i = 0; i < 20; i++) {
      if (await continueBtn.isEnabled()) break;
      await page.waitForTimeout(500);
    }
    await continueBtn.click({ force: true });

    // Handle any intermediate notification/popup that the portal may show
    try {
      const notifContinue = page.locator(
        'mat-dialog-container button:has-text("Continue"), .notification button:has-text("Continue"), [id*="Notification"] button:has-text("Continue")'
      );
      await notifContinue.waitFor({ state: 'visible', timeout: 5000 });
      await notifContinue.click();
      await hook.send(infoEvent('NAVIGATING', 'DISMISSED_NOTIFICATION', 'Dismissed portal notification popup'));
    } catch { /* no popup */ }

    await page.waitForLoadState('domcontentloaded');
    await hook.send(infoEvent('NAVIGATING', 'DETECTING_NEXT_STEP', 'Detecting portal next step after Continue...'));

    // -----------------------------------------------------------------------
    // PHASE: CAPTCHA (conditional)
    // The ITR portal MAY show a CAPTCHA on the Forgot Password Step 1 page.
    // We detect which state we are in using Promise.race:
    //   - "captcha"       → CAPTCHA input is visible → solve it
    //   - "select-option" → Portal jumped to Step 2 directly → skip CAPTCHA
    // -----------------------------------------------------------------------
    t = fsm.transition('CAPTCHA');
    await hook.send(infoEvent('CAPTCHA', 'CAPTCHA_PHASE_START', 'Checking for CAPTCHA or Step 2 (Select Reset Option)...'), { phaseTransition: t });

    const portalNextStep = await Promise.race([
      page.waitForSelector(
        'input[formcontrolname="captcha"], input[name="captcha"], input#captcha, input[placeholder*="captcha" i]',
        { state: 'visible', timeout: 8000 }
      ).then(() => 'captcha' as const),
      page.waitForSelector(
        'input[type="radio"], label:has-text("Aadhaar"), text=Select an Option to Reset Password, text=OTP on mobile number',
        { state: 'visible', timeout: 8000 }
      ).then(() => 'select-option' as const),
    ]).catch(() => 'select-option' as const); // default: assume Step 2 if nothing detected

    if (portalNextStep === 'captcha') {
      await hook.send(infoEvent('CAPTCHA', 'CAPTCHA_DETECTED', 'CAPTCHA challenge detected — screenshot sent to operator'));
      await solveCaptchaWithRetry(page, jobId, hook, fsm);
      // After CAPTCHA solved, portal will show Step 2 — wait for it
      await page.waitForSelector(
        'input[type="radio"], label:has-text("Aadhaar"), text=Select an Option to Reset Password',
        { state: 'visible', timeout: 15000 }
      );
    } else {
      await hook.send(infoEvent('CAPTCHA', 'CAPTCHA_NOT_REQUIRED', 'Portal skipped CAPTCHA — now on Step 2: Select Reset Option'));
    }

    // -----------------------------------------------------------------------
    // PHASE: FILLING_DETAILS
    // Step 2 — Select reset option: "OTP on mobile number registered with Aadhaar"
    // Step 3 — Click "Generate OTP" to send OTP to Aadhaar-linked mobile
    // -----------------------------------------------------------------------
    t = fsm.transition('FILLING_DETAILS');
    await hook.send(infoEvent('FILLING_DETAILS', 'FILLING_DETAILS_START', 'Step 2 loaded — selecting Aadhaar OTP method'), { phaseTransition: t });

    // --- Step 2: Select Aadhaar OTP radio button ---
    let aadhaarSelected = false;
    try {
      // Try clicking the radio input directly
      await page.locator('input[value="aadhaarOtp"]').first().click({ timeout: 8000 });
      aadhaarSelected = true;
    } catch {
      try {
        // Try clicking the label
        await page.locator('label:has-text("OTP on mobile number registered with Aadhaar")').first().click({ timeout: 6000 });
        aadhaarSelected = true;
      } catch {
        try {
          // Last resort: click by visible text
          await page.getByText('OTP on mobile number registered with Aadhaar').first().click({ timeout: 6000 });
          aadhaarSelected = true;
        } catch { /* will warn below */ }
      }
    }

    if (!aadhaarSelected) {
      await hook.send(warnEvent('FILLING_DETAILS', 'AADHAAR_SELECT_WARN', 'Could not select Aadhaar OTP radio — attempting to continue anyway'));
    } else {
      await hook.send(infoEvent('FILLING_DETAILS', 'AADHAAR_OTP_SELECTED', 'Selected: OTP on mobile number registered with Aadhaar'));
    }
    await page.waitForTimeout(500);

    // Accept declaration checkbox if present (some portal versions require it)
    try {
      const checkbox = page.locator('input[type="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 3000 })) {
        await checkbox.check();
        await hook.send(infoEvent('FILLING_DETAILS', 'DECLARATION_CHECKED', 'Aadhaar consent declaration checked'));
      }
    } catch { /* checkbox may not be present */ }

    // Click "Continue" to proceed from Step 2 to Step 3
    await hook.send(infoEvent('FILLING_DETAILS', 'CLICK_CONTINUE_STEP2', 'Clicking Continue to go to Step 3 (Generate OTP)'));
    await page.click('button:has-text("Continue"), button[type="submit"]');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // --- Step 3: Click "Generate OTP" to trigger SMS to Aadhaar-linked mobile ---
    try {
      const generateOtpBtn = page.locator('button:has-text("Generate OTP"), button:has-text("Send OTP")').first();
      const isVisible = await generateOtpBtn.isVisible({ timeout: 6000 });
      if (isVisible) {
        await hook.send(infoEvent('FILLING_DETAILS', 'CLICK_GENERATE_OTP', 'Step 3 loaded — clicking Generate OTP'));
        await generateOtpBtn.click();
        await page.waitForTimeout(2000);
      } else {
        await hook.send(infoEvent('FILLING_DETAILS', 'GENERATE_OTP_NOT_FOUND', 'Generate OTP button not visible — OTP may already be triggered'));
      }
    } catch {
      await hook.send(infoEvent('FILLING_DETAILS', 'GENERATE_OTP_SKIPPED', 'No Generate OTP button found — portal may have auto-sent OTP'));
    }

    // Wait for OTP input field to appear (confirms OTP was sent)
    try {
      await page.waitForSelector(
        'input[formcontrolname="otp"], input[name="otp"], input#otp, input[placeholder*="OTP" i], input[placeholder*="Enter OTP" i]',
        { state: 'visible', timeout: 15000 }
      );
      await hook.send(infoEvent('FILLING_DETAILS', 'OTP_FIELD_VISIBLE', 'OTP input field appeared — OTP has been sent to Aadhaar-linked mobile'));
    } catch {
      await hook.send(warnEvent('FILLING_DETAILS', 'OTP_FIELD_WAIT', 'OTP input not detected yet — proceeding to wait for operator'));
    }

    // -----------------------------------------------------------------------
    // PHASE: WAITING_FOR_OTP
    // Bot pauses here — operator reads the OTP on their phone and types it
    // into the dashboard OTP input, then submits it.
    // -----------------------------------------------------------------------
    t = fsm.transition('WAITING_FOR_OTP');
    await hook.send(
      infoEvent('WAITING_FOR_OTP', 'OTP_REQUESTED', 'OTP sent to Aadhaar-linked mobile. Please enter the OTP in the dashboard below.'),
      { phaseTransition: t }
    );

    // OTP retry loop (up to 3 wrong OTP attempts)
    let otpSuccess = false;
    let otpAttempts = 0;
    const MAX_OTP_ATTEMPTS = 3;

    while (!otpSuccess && otpAttempts < MAX_OTP_ATTEMPTS) {
      // Poll service for OTP submitted by operator via the dashboard
      const otp = await pollForOtp(jobId, hook);

      // Transition to SUBMITTING_OTP
      t = fsm.transition('SUBMITTING_OTP');
      await hook.send(
        infoEvent('SUBMITTING_OTP', 'OTP_RECEIVED', `OTP received from operator — submitting (attempt ${otpAttempts + 1}/${MAX_OTP_ATTEMPTS})`),
        { phaseTransition: t }
      );

      // Find and fill OTP input field
      const otpInput = page.locator(
        'input[formcontrolname="otp"], input[name="otp"], input#otp, input[placeholder*="OTP" i], input[placeholder*="Enter OTP" i]'
      ).first();
      await otpInput.waitFor({ state: 'visible', timeout: 10000 });
      await otpInput.fill(otp);
      await page.waitForTimeout(500);

      // Click Validate/Continue to submit OTP
      await hook.send(infoEvent('SUBMITTING_OTP', 'OTP_SUBMITTED', 'OTP entered — clicking Validate'));
      await page.click('button:has-text("Validate"), button:has-text("Verify OTP"), button:has-text("Continue"), button[type="submit"]');
      await page.waitForTimeout(3000);

      // Check if OTP was rejected
      const errText = await page.locator(
        'mat-error, .error-message, .alert-danger, [class*="error"], span:has-text("Invalid"), span:has-text("incorrect")'
      ).first().textContent({ timeout: 4000 }).catch(() => null);

      if (errText && (errText.toLowerCase().includes('invalid') || errText.toLowerCase().includes('incorrect') || errText.toLowerCase().includes('wrong'))) {
        otpAttempts++;
        await hook.send(warnEvent('SUBMITTING_OTP', 'OTP_INVALID',
          `OTP rejected by portal (attempt ${otpAttempts}/${MAX_OTP_ATTEMPTS}). ${otpAttempts < MAX_OTP_ATTEMPTS ? 'Enter the correct OTP.' : 'Max attempts reached.'}`
        ));

        if (otpAttempts >= MAX_OTP_ATTEMPTS) {
          throw new Error(`OTP validation failed after ${MAX_OTP_ATTEMPTS} attempts`);
        }

        // Back to WAITING_FOR_OTP for retry
        t = fsm.transition('WAITING_FOR_OTP');
        await hook.send(
          infoEvent('WAITING_FOR_OTP', 'OTP_RETRY', `Please enter the correct OTP (attempt ${otpAttempts + 1}/${MAX_OTP_ATTEMPTS})`),
          { phaseTransition: t }
        );
      } else {
        otpSuccess = true;
        await hook.send(infoEvent('SUBMITTING_OTP', 'OTP_ACCEPTED', 'OTP validated successfully — proceeding to password reset'));
      }
    }

    // -----------------------------------------------------------------------
    // PHASE: SETTING_PASSWORD
    // -----------------------------------------------------------------------
    t = fsm.transition('SETTING_PASSWORD');
    await hook.send(infoEvent('SETTING_PASSWORD', 'PASSWORD_PHASE_START', 'Setting new password'), { phaseTransition: t });

    const newPassword = generateStrongPassword();

    // Fill new password fields
    const pwdField = page.locator('input[formcontrolname="newPassword"], input[name="newPassword"], input#newPassword').first();
    const confirmPwd = page.locator('input[formcontrolname="confirmPassword"], input[name="confirmPassword"], input#confirmPassword').first();

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
    const encryptedUserId = encrypt(pan);   // PAN is the User ID on IT portal
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
