import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  
  await page.goto('http://127.0.0.1:4173');
  
  await page.evaluate(() => {
    localStorage.setItem('pixiechess-storage', JSON.stringify({
      state: {
        placementColor: 'b',
        autoMove: false,
        thinkTimeMs: 2000
      },
      version: 0
    }));
  });
  await page.reload();

  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'screenshot2.png' });
  
  await browser.close();
})();
