import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

// Profile pic (400x400)
await page.setViewportSize({ width: 400, height: 400 });
await page.goto('file:///Users/hyunwoo/.openclaw/workspace/assets/twitter-profile.html');
await page.waitForTimeout(500);
await page.screenshot({ path: '/Users/hyunwoo/.openclaw/workspace/assets/twitter-profile.png', omitBackground: true });
console.log('✅ Profile pic saved');

// Header (1500x500)
await page.setViewportSize({ width: 1500, height: 500 });
await page.goto('file:///Users/hyunwoo/.openclaw/workspace/assets/twitter-header.html');
await page.waitForTimeout(1000); // wait for font
await page.screenshot({ path: '/Users/hyunwoo/.openclaw/workspace/assets/twitter-header.png' });
console.log('✅ Header saved');

await browser.close();
