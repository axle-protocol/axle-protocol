import { chromium } from 'playwright';

const PAGES = [
  { url: 'https://agentmarket.kr', name: 'home' },
  { url: 'https://agentmarket.kr/agents', name: 'agents' },
  { url: 'https://agentmarket.kr/agents/blog-master', name: 'agent-detail' },
  { url: 'https://agentmarket.kr/dashboard', name: 'dashboard' },
  { url: 'https://agentmarket.kr/privacy', name: 'privacy' },
  { url: 'https://agentmarket.kr/terms', name: 'terms' },
];

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'desktop', width: 1440, height: 900 },
];

const browser = await chromium.launch({ 
  executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  headless: true 
});

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  for (const page of PAGES) {
    const p = await context.newPage();
    try {
      await p.goto(page.url, { waitUntil: 'networkidle', timeout: 15000 });
      const path = `/Users/hyunwoo/.openclaw/workspace/screenshots/${vp.name}-${page.name}.png`;
      await p.screenshot({ path, fullPage: true });
      console.log(`✅ ${vp.name}/${page.name}`);
    } catch (e) {
      console.log(`❌ ${vp.name}/${page.name}: ${e.message}`);
    }
    await p.close();
  }
  await context.close();
}

await browser.close();
console.log('Done!');
