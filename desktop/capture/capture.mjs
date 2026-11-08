import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const states = {
  brief: ['Daily Brief', 'Read the explainer'],
  'brief-expanded-lower': ['Daily Brief', 'Read the explainer', 'brief'],
  'brief-empty': ['Daily Brief', 'Nothing to recap.'],
  'brief-loading': ['Daily Brief', 'Scanning'],
  'brief-error': ['Daily Brief', 'The brief could not be written.'],
  library: ['Concept Library', 'Everything you'],
  reader: ['Concept Library', 'Back to the library'],
  'reader-lower': ['Concept Library', 'Back to the library', 'reader'],
  'library-empty': ['Concept Library', 'Nothing here yet.'],
  'library-loading': ['Concept Library', 'Reading the library'],
  'library-error': ['Concept Library', "Couldn't load the library."],
  signals: ['Signal Explorer', 'Why the engine chose'],
  'signals-lower': ['Signal Explorer', 'Why the engine chose', 'signals'],
  'signals-empty': ['Signal Explorer', 'The last scan found no learning moments'],
  'signals-loading': ['Signal Explorer', "Scanning this machine's sessions"],
  'signals-error': ['Signal Explorer', 'Live scan failed'],
  'review-due': ['Review', 'Show answer'],
  'review-revealed': ['Review', 'How well did you remember?'],
  'review-revealed-lower': ['Review', 'How well did you remember?', 'review-revealed'],
  'review-caught-up': ['Review', 'Nothing due today.'],
  'review-loading': ['Review', "Reading what's due"],
  'review-error': ['Review', "Couldn't load your review list."],
  settings: ['Settings', 'Inference CLI'],
  'settings-lower': ['Settings', 'Inference CLI', 'settings'],
  'settings-loading': ['Settings', 'Reading settings'],
  'settings-error': ['Settings', 'Settings live in the app shell'],
};
const sizes = process.env.CAPTURE_SIZES?.split(',') ?? ['960x640', '1200x800', '1600x1000'];
const output = resolve(process.env.CAPTURE_DIR ?? 'capture-output');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/local/bin/chromium', args: ['--no-sandbox'] });
try {
  for (const size of sizes) for (const theme of ['light', 'dark']) {
    const [width, height] = size.split('x').map(Number);
    if (!width || !height) throw new Error(`Invalid size: ${size}`);
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, locale: 'en-US', timezoneId: 'America/New_York', deviceScaleFactor: 1 });
    for (const [state, [nav, expected, fixture = state]] of Object.entries(states)) {
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date('2026-11-03T12:00:00Z'));
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:1421/?state=${fixture}`);
      await page.getByRole('button', { name: nav, exact: true }).click();
      await page.getByText(expected, { exact: false }).first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      if (state === 'brief-expanded-lower') {
        await page.getByRole('button', { name: /Read the explainer/ }).first().click();
        await page.getByRole('button', { name: /Show the exchange/ }).first().click();
      }
      if (state === 'reader-lower') await page.getByRole('button', { name: /Show the exchange/ }).click();
      if (state === 'review-revealed-lower') await page.getByRole('button', { name: /Show the exchange/ }).click();
      if (state === 'settings-lower') await page.getByText('Augmented PATH', { exact: true }).click();
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
