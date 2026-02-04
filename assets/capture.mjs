import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function capture() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  
  // Profile pic 400x400
  const page1 = await browser.newPage();
  await page1.setViewport({ width: 400, height: 400 });
  await page1.goto(`file://${join(__dirname, 'twitter-profile.html')}`);
  await page1.screenshot({ path: join(__dirname, 'twitter-profile.png') });
  console.log('✅ twitter-profile.png (400x400)');

  // Header 1500x500
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1500, height: 500 });
  await page2.goto(`file://${join(__dirname, 'twitter-header.html')}`);
  await page2.screenshot({ path: join(__dirname, 'twitter-header.png') });
  console.log('✅ twitter-header.png (1500x500)');
  
  await browser.close();
}

capture().catch(e => { console.error(e); process.exit(1); });
