import { chromium } from 'playwright';
const base = 'http://localhost:4173';
const b = await chromium.launch();
for (const w of [320, 360, 375, 390, 414, 640]) {
  const p = await b.newPage({ viewport: { width: w, height: 800 } });
  await p.goto(base + '/data', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('header');
  const r = await p.evaluate(() => {
    const bar = document.querySelector('header > div > div');
    if (!bar) return { error: 'no bar' };
    const kids = [...bar.children].map((c) => {
      const box = c.getBoundingClientRect();
      return { top: Math.round(box.top), left: Math.round(box.left), w: Math.round(box.width) };
    });
    // control widths inside right group
    const right = bar.children[1];
    const parts = right ? [...right.children].map((c) => ({
      label: c.getAttribute('aria-label') || c.textContent.slice(0, 12),
      w: Math.round(c.getBoundingClientRect().width),
      top: Math.round(c.getBoundingClientRect().top),
    })) : [];
    return {
      barH: Math.round(bar.getBoundingClientRect().height),
      rows: new Set(kids.map((k) => k.top)).size,
      kids, parts,
      docScroll: document.documentElement.scrollWidth,
    };
  });
  console.log(w, JSON.stringify(r, null, 1));
  await p.close();
}
await b.close();
