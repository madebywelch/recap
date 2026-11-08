import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const states = {
  brief: ['Daily Brief', 'Read the explainer'],
  'brief-expanded-lower': ['Daily Brief', 'Read the explainer', 'brief'],
  'brief-empty': ['Daily Brief', 'Nothing to recap.'],
  'brief-loading': ['Daily Brief', 'Scanning'],
  'brief-error': ['Daily Brief', "Couldn't write your brief."],
  'brief-load-error': ['Daily Brief', "Couldn't load your brief."],
  'brief-generating': ['Daily Brief', "Running today's recap"],
  'brief-cta': ['Daily Brief', "Today's brief isn't written yet."],
  'brief-no-cli': ['Daily Brief', 'A tool is needed to write your brief.'],
  library: ['Concept Library', 'Everything you'],
  reader: ['Concept Library', 'Back to the library'],
  'reader-lower': ['Concept Library', 'Back to the library', 'reader'],
  'library-empty': ['Concept Library', 'Nothing here yet.'],
  'library-loading': ['Concept Library', 'Reading the library'],
  'library-error': ['Concept Library', "Couldn't load the library."],
  signals: ['Signal Explorer', 'Why the engine chose'],
  'signals-lower': ['Signal Explorer', 'Why the engine chose', 'signals'],
  'signals-empty': ['Signal Explorer', 'The last scan found no learning moments'],
  'signals-error': ['Signal Explorer', 'Live scan failed'],
  'review-due': ['Review', 'Show answer'],
  'review-revealed': ['Review', 'How well did you remember?'],
  'review-revealed-lower': ['Review', 'How well did you remember?', 'review-revealed'],
  'review-caught-up': ['Review', 'Nothing due today.'],
  'review-loading': ['Review', "Reading what's due"],
  'review-error': ['Review', "Couldn't load your review list."],
  settings: ['Settings', 'Writing tool'],
  'settings-lower': ['Settings', 'Writing tool', 'settings'],
  'settings-advanced': ['Settings', 'Show engine details', 'settings'],
  'settings-tool-error': ['Settings', "but couldn't run"],
  'settings-sources-error': ['Settings', "couldn't check"],
  'settings-loading': ['Settings', 'Reading settings'],
  'settings-error': ['Settings', "Couldn't load settings"],
  'first-run': [null, 'Welcome to recap.'],
  'first-run-lower': [null, 'Welcome to recap.', 'first-run'],
  refusal: [null, 'Something isn’t working.'],
};
const sizes = process.env.CAPTURE_SIZES?.split(',') ?? ['960x640', '1200x800', '1600x1000'];
const selectedStates = process.env.CAPTURE_STATES?.split(',');
if (selectedStates?.some(state => !(state in states))) throw new Error('Unknown capture state');
const output = resolve(process.env.CAPTURE_DIR ?? 'capture-output');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/local/bin/chromium', args: ['--no-sandbox'] });
try {
  for (const size of sizes) for (const theme of ['light', 'dark']) {
    const [width, height] = size.split('x').map(Number);
    if (!width || !height) throw new Error(`Invalid size: ${size}`);
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, locale: 'en-US', timezoneId: 'America/New_York', deviceScaleFactor: 1 });
    for (const [state, [nav, expected, fixture = state]] of Object.entries(states)) {
      if (selectedStates && !selectedStates.includes(state)) continue;
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date('2026-11-03T12:00:00Z'));
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:1421/?state=${fixture}`);
      if (await page.getByRole('button', { name: 'Signal Explorer', exact: true }).count()) throw new Error(`${state}: diagnostics are visible by default`);
      if (nav === 'Signal Explorer') {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await page.getByLabel('Show engine details').check();
        await page.getByRole('button', { name: 'Save', exact: true }).click();
      }
      if (nav) await page.getByRole('button', { name: nav, exact: true }).click();
      await page.getByText(expected, { exact: false }).first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      if (state === 'brief-expanded-lower') {
        await page.getByRole('button', { name: /Read the explainer/ }).first().click();
        await page.getByRole('button', { name: /Show the exchange/ }).first().click();
      }
      if (state === 'reader-lower') await page.getByRole('button', { name: /Show the exchange/ }).click();
      if (state === 'review-revealed-lower') await page.getByRole('button', { name: /Show the exchange/ }).click();
      if (state === 'settings-lower') await page.getByText('Where recap looks for tools', { exact: true }).click();
      if (state === 'settings-advanced') await page.getByLabel('Show engine details').scrollIntoViewIfNeeded();
      if (state === 'first-run-lower') await page.getByRole('button', { name: 'Get started' }).scrollIntoViewIfNeeded();
      if (state === 'review-due') {
        const progress = page.getByRole('progressbar', { name: 'Review progress' });
        const value = await progress.getAttribute('aria-valuenow');
        const width = await progress.locator('span').evaluate(element => element.style.width);
        if (value !== '1' || Math.abs(parseFloat(width) - 100 / 3) > 0.01) throw new Error(`Unexpected review progress: ${value}, ${width}`);
      }
      if (state === 'brief-expanded-lower') {
        await page.locator('.entry.open .source').first().scrollIntoViewIfNeeded();
      } else if (state === 'reader-lower') {
        await page.locator('.concept-sources').scrollIntoViewIfNeeded();
      } else if (state === 'review-revealed-lower') {
        await page.locator('.studio-review-source').first().scrollIntoViewIfNeeded();
      } else if (state.endsWith('-lower')) {
        await page.evaluate(() => {
          for (const element of document.querySelectorAll('*')) {
            if (element.scrollHeight > element.clientHeight && /auto|scroll/.test(getComputedStyle(element).overflowY)) element.scrollTop = element.scrollHeight;
          }
        });
      }
      if (errors.length) throw new Error(`${state}: ${errors.join('; ')}`);
      const dir = resolve(output, size, theme);
      await mkdir(dir, { recursive: true });
      await page.screenshot({ path: resolve(dir, `${state}.png`), animations: 'disabled' });
      console.log(`${size}/${theme}/${state}.png`);
      await page.close();
    }
    await context.close();
  }
} finally { await browser.close(); }
