// npm install --no-save playwright@1.65.1 && npx playwright install chromium
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd();
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const content = fs.readFileSync(file);
    response.setHeader('Content-Type', file.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8');
    response.end(content);
  } catch { response.writeHead(404).end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
fs.mkdirSync('evidence', {recursive:true});
try {
  browser = await chromium.launch({headless:true});
  for (const [name,width,height] of [['desktop',1440,1000], ['mobile',390,844], ['small-mobile',320,740]]) {
    const context = await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => ({
      width:innerWidth, scrollWidth:document.documentElement.scrollWidth,
      imageFailures:[...document.images].filter(image => !image.complete || !image.naturalWidth).map(image => image.src),
      links:[...document.querySelectorAll('a')].map(a => a.getAttribute('href')),
      referralVisible:(() => {const r=document.querySelector('.referral a').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})(),
      title:document.title
    }));
    assert.equal(result.width, result.scrollWidth, `${name}: horizontal overflow`);
    assert.deepEqual(result.imageFailures, [], `${name}: broken assets`);
    assert.ok(result.referralVisible, `${name}: referral must be visible in initial viewport`);
    for (const href of result.links) {
      if (href.startsWith('https://make.fun/')) assert.ok(href.includes('mc348h49'), `Referral missing: ${href}`);
    }
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    await page.locator('#copy-prompt').click();
    await page.waitForFunction(() => document.querySelector('#copy-status').textContent.length > 0);
    result.copyStatus = await page.locator('#copy-status').textContent();
    assert.match(result.copyStatus, /Prompt tersalin/);
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /https:\/\/make.fun\/skill.md/);
    await page.locator('summary').nth(3).click();
    assert.ok(await page.getByText('Peringkat ditentukan oleh jumlah pendaftaran').isVisible());
    await page.locator('summary').nth(3).click();
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('a[href="#bounty"]').first().click({force:true}).catch(() => {});
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({path:`evidence/${name}.png`,fullPage:true});
    if(name==='desktop') await page.screenshot({path:'ad.png',fullPage:false});
    assert.deepEqual(errors, [], `${name}: JavaScript errors`);
    results.push({name,...result,errors});
    await context.close();
  }
  fs.writeFileSync('evidence/browser-results.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally {
  if(browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
