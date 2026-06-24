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

// ---------------------------------------------------------------------------
// Helper: Wait for Angular Material CDK overlay (loading spinner) to disappear
// before attempting any clicks — otherwise the overlay intercepts the click.
// ---------------------------------------------------------------------------
async function waitForOverlayToDisappear(page: Page, timeout = 10000): Promise<void> {
  try {
    await page.waitForSelector('.cdk-overlay-backdrop, .cdk-overlay-container .customLoaderBackdrop', {
      state: 'hidden',
      timeout,
    });
  } catch {
    // If overlay selector not found or times out, just continue
  }
  await page.waitForTimeout(300);
}

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

    // --- Step 3a: Select "Generate OTP" option (Option 2) and click Continue ---
    await hook.send(infoEvent('FILLING_DETAILS', 'WAITING_FOR_STEP3', 'Waiting for Step 3 (Verify Identity option screen) to load...'));
    
    // Wait for any loading overlay to disappear, then wait for radio buttons
    await waitForOverlayToDisappear(page);
    await page.waitForSelector('input[type="radio"]', { timeout: 15000 });

    // Step 3a has two options:
    // 1. I already have an OTP
    // 2. Generate OTP
    let optionSelected = false;
    try {
      // Option A: Click by label text containing "Generate"
      const generateRadioLabel = page.locator('label:has-text("Generate"), text="Generate OTP", text="Generate Aadhaar OTP"').first();
      if (await generateRadioLabel.isVisible({ timeout: 5000 })) {
        await generateRadioLabel.click({ force: true });
        optionSelected = true;
        await hook.send(infoEvent('FILLING_DETAILS', 'GENERATE_OTP_RADIO_CLICKED', 'Selected "Generate OTP" option via label text'));
      }
    } catch { /* try fallback */ }

    if (!optionSelected) {
      try {
        // Option B: Select the second radio button on the page (index 1)
        const radios = page.locator('input[type="radio"]');
        const count = await radios.count();
        if (count >= 2) {
          await radios.nth(1).click({ force: true });
          optionSelected = true;
          await hook.send(infoEvent('FILLING_DETAILS', 'GENERATE_OTP_RADIO_CLICKED', 'Selected "Generate OTP" option (second radio button)'));
        } else if (count === 1) {
          await radios.nth(0).click({ force: true });
          optionSelected = true;
          await hook.send(infoEvent('FILLING_DETAILS', 'GENERATE_OTP_RADIO_CLICKED', 'Selected "Generate OTP" option (only radio button available)'));
        }
      } catch { /* fallback */ }
    }

    if (!optionSelected) {
      await hook.send(warnEvent('FILLING_DETAILS', 'GENERATE_OTP_RADIO_WARN', 'Could not explicitly select "Generate OTP" radio, trying to proceed...'));
    }

    await page.waitForTimeout(500);

    // Click Continue to proceed from option screen to consent screen
    await hook.send(infoEvent('FILLING_DETAILS', 'CLICK_CONTINUE_STEP3', 'Clicking Continue to go to Consent screen'));
    const continueBtnRadioScreen = page.locator('button:has-text("Continue"), button[type="submit"]').first();
    await waitForOverlayToDisappear(page);
    await continueBtnRadioScreen.click({ force: true });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // --- Step 3b: Accept consent and click "Generate Aadhaar OTP" ---
    await hook.send(infoEvent('FILLING_DETAILS', 'WAITING_FOR_CONSENT_SCREEN', 'Waiting for Consent page to load...'));
    
    // In Step 3b, we must check "I agree to validate my Aadhaar details"
    // Wait for overlay to clear before any consent interaction
    await waitForOverlayToDisappear(page, 12000);
    try {
      let checked = false;

      // Try Option 1: click label by text
      const consentText = page.getByText("I agree to validate", { exact: false }).first();
      try {
        await consentText.waitFor({ state: 'visible', timeout: 8000 });
        await consentText.click({ force: true });
        checked = true;
        await hook.send(infoEvent('FILLING_DETAILS', 'AADHAAR_CONSENT_CHECKED', 'Clicked Aadhaar consent text label'));
      } catch { /* try fallback */ }

      // Try Option 2: click raw checkbox input
      if (!checked) {
        const checkboxInput = page.locator('input[type="checkbox"]').first();
        try {
          await checkboxInput.waitFor({ state: 'visible', timeout: 3000 });
          await checkboxInput.check({ force: true });
          checked = true;
          await hook.send(infoEvent('FILLING_DETAILS', 'AADHAAR_CONSENT_CHECKED', 'Checked Aadhaar consent checkbox input'));
        } catch { /* try fallback */ }
      }

      // Try Option 3: mat-checkbox click
      if (!checked) {
        const matCheckbox = page.locator('mat-checkbox').first();
        try {
          await matCheckbox.waitFor({ state: 'visible', timeout: 3000 });
          await matCheckbox.click({ force: true });
          checked = true;
          await hook.send(infoEvent('FILLING_DETAILS', 'AADHAAR_CONSENT_CHECKED', 'Clicked mat-checkbox element'));
        } catch { /* fallback */ }
      }

      // Try Option 4: mouse coordinate click on the text label
      if (!checked) {
        try {
          const consentText = page.getByText("I agree to validate", { exact: false }).first();
          const box = await consentText.boundingBox();
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            checked = true;
            await hook.send(infoEvent('FILLING_DETAILS', 'AADHAAR_CONSENT_CHECKED', 'Clicked Aadhaar consent text coordinates via mouse'));
          }
        } catch { /* fallback */ }
      }

      if (!checked) {
        // Diagnostic HTML extraction to help troubleshoot
        let diagJson = 'N/A';
        try {
          diagJson = await page.evaluate(`(() => {
            try {
              const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"], mat-checkbox, [role="checkbox"]'));
              const cbInfo = checkboxes.map((c, i) => i + ': tag=' + c.tagName + ' id=' + c.id + ' class=' + c.className + ' visible=' + (c.getBoundingClientRect().width > 0));
              
              const labels = Array.from(document.querySelectorAll('label, span, p, div'));
              const agreeLabels = labels
                .filter(l => l.textContent && /agree|validate|aadhaar/i.test(l.textContent))
                .map(l => l.tagName + ' text="' + l.textContent.trim().substring(0, 60) + '"');
                
              return JSON.stringify({ checkboxes: cbInfo, labels: agreeLabels.slice(0, 10) });
            } catch (e) {
              return 'Error in diag: ' + e.message;
            }
          })()`) as string;
        } catch (e: any) {
          diagJson = 'Eval failed: ' + e.message;
        }
        await hook.send(warnEvent('FILLING_DETAILS', 'AADHAAR_CONSENT_MISSING', `Could not click Aadhaar consent checkbox. Page elements: ${diagJson}`));
      }

      await page.waitForTimeout(1000);
    } catch (err) {
      await hook.send(warnEvent('FILLING_DETAILS', 'AADHAAR_CONSENT_ERROR', `Error in Aadhaar consent checkbox step: ${err instanceof Error ? err.message : String(err)}`));
    }

    // Now click the "Generate Aadhaar OTP" button to trigger SMS to Aadhaar-linked mobile
    await hook.send(infoEvent('FILLING_DETAILS', 'CLICK_GENERATE_OTP', 'Clicking Generate Aadhaar OTP button'));
    const generateBtnConsentScreen = page.locator('button:has-text("Generate Aadhaar OTP"), button:has-text("Generate OTP"), button:has-text("Continue"), button[type="submit"]').first();
    await waitForOverlayToDisappear(page);
    await generateBtnConsentScreen.click({ force: true });
    await page.waitForTimeout(3000);

    // Wait for OTP input field to confirm OTP was sent (make this optional so we don't fail if the selector is slightly different)
    try {
      await page.waitForSelector(
        'input[formcontrolname="otp"], input[name="otp"], input#otp, input[placeholder*="OTP" i], input[placeholder*="Enter OTP" i]',
        { state: 'visible', timeout: 8000 }
      );
      await hook.send(infoEvent('FILLING_DETAILS', 'OTP_FIELD_VISIBLE', 'OTP input field is visible.'));
    } catch {
      await hook.send(infoEvent('FILLING_DETAILS', 'OTP_FIELD_WAIT_TIMEOUT', 'Proceeding to ask for OTP (could not strictly verify field visibility).'));
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
      let otpFilled = false;
      const otpSelectors = [
        'input[formcontrolname="otp"]', 'input[name="otp"]', 'input#otp',
        'input[placeholder*="OTP" i]', 'input[placeholder*="Enter OTP" i]',
        'input[autocomplete="one-time-code"]', 'input[maxlength="6"]'
      ].join(', ');
      
      const otpInput = page.locator(otpSelectors).first();
      try {
        await otpInput.waitFor({ state: 'visible', timeout: 5000 });
        await otpInput.fill(otp);
        otpFilled = true;
      } catch {
        // Fallback: try to find the only visible text/password input on the page
        try {
           const visibleInputs = page.locator('input[type="text"]:visible, input[type="password"]:visible, input:not([type]):visible');
           if (await visibleInputs.count() > 0) {
             // Fill the first or last depending on layout, typically there's only one relevant input now
             await visibleInputs.first().fill(otp);
             otpFilled = true;
           }
        } catch { /* ignore fallback errors */ }
      }

      if (!otpFilled) {
        throw new Error('Could not find OTP input field on the portal to fill.');
      }
      await page.waitForTimeout(500);

      // Click Validate/Continue to submit OTP
      await hook.send(infoEvent('SUBMITTING_OTP', 'OTP_SUBMITTED', 'OTP entered — clicking Validate'));
      
      // Look for the submit button
      const submitBtnSelectors = [
        'button:has-text("Validate")', 'button:has-text("Verify")', 'button:has-text("Submit")',
        'button:has-text("Continue")', 'button[type="submit"]', '.primary-button'
      ].join(', ');
      
      const submitBtn = page.locator(submitBtnSelectors).first();
      try {
        await submitBtn.click({ force: true, timeout: 5000 });
      } catch {
        // Fallback: press Enter on the OTP input
        await page.keyboard.press('Enter');
      }
      
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
