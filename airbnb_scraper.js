/**
 * Airbnb-Scraper: Ostfildern-Scharnhausen
 * Check-in: 22.05.2026 | Check-out: 24.05.2026
 *
 * Ausführung:
 *   npm install playwright
 *   npx playwright install chromium
 *   node airbnb_scraper.js
 *
 * Ausgabe: airbnb_ergebnisse.csv
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ── Konfiguration ──────────────────────────────────────────────
const CONFIG = {
  location: 'Ostfildern-Scharnhausen',
  checkin: '2026-05-22',
  checkout: '2026-05-24',
  adults: 1,
  currency: 'EUR',
  maxPages: 10,
  outputFile: path.join(__dirname, 'airbnb_ergebnisse.csv'),
  screenshotDir: path.join(__dirname, 'screenshots'),
  headless: true,
};
// ──────────────────────────────────────────────────────────────

function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).replace(/\r?\n/g, ' ').trim();
  return str.includes('"') || str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
}

function writeCsv(filePath, rows) {
  const headers = ['Titel', 'Unterzeile', 'Preis_pro_Nacht', 'Gesamtpreis', 'Bewertung', 'Anzahl_Bewertungen', 'Superhost', 'URL'];
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [r.titel, r.unterzeile, r.preis, r.gesamtpreis, r.bewertung, r.anzahlBewertungen, r.superhost, r.url]
        .map(escapeCsv)
        .join(',')
    ),
  ];
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

/** Extrahiert Listings aus einer geladenen Airbnb-Suchergebnisseite */
async function extractListings(page) {
  return page.evaluate(() => {
    const results = [];

    // Haupt-Selektoren für Listing-Karten (in Prioritätsreihenfolge)
    const cardSelectors = [
      '[data-testid="listing-card-wrapper"]',
      '[data-testid="card-container"]',
      'div[class*="g1qv1ctd"]',
      '[itemtype="http://schema.org/ListItem"]',
    ];

    let cards = [];
    for (const sel of cardSelectors) {
      cards = [...document.querySelectorAll(sel)];
      if (cards.length > 0) break;
    }

    // Fallback: alle Links zu Einzelinseraten sammeln
    if (cards.length === 0) {
      const links = [...document.querySelectorAll('a[href*="/rooms/"]')];
      links.forEach((link) => {
        const card = link.closest('[class]') || link.parentElement;
        if (card && !cards.includes(card)) cards.push(card);
      });
    }

    cards.forEach((card) => {
      try {
        // Titel
        const titleEl =
          card.querySelector('[data-testid="listing-card-title"]') ||
          card.querySelector('div[class*="t1jojoys"]') ||
          card.querySelector('span[class*="t1jojoys"]') ||
          card.querySelector('h3') || card.querySelector('h2') ||
          card.querySelector('[aria-label]');
        const titel = titleEl?.innerText?.trim() ?? '';

        // Unterzeile (Zimmertyp / Stockwerk)
        const subEl =
          card.querySelector('div[class*="fb4nyux"]') ||
          card.querySelector('[data-testid="listing-card-subtitle"]') ||
          card.querySelector('span[class*="s1cjsi4j"]');
        const unterzeile = subEl?.innerText?.trim() ?? '';

        // Preis pro Nacht – suche nach €-Zeichen
        let preis = '';
        let gesamtpreis = '';
        const allSpans = [...card.querySelectorAll('span, div')];
        const priceSpans = allSpans.filter((el) => {
          const txt = el.innerText?.trim() ?? '';
          return txt.match(/^\d[\d.,]*\s*€/) || txt.match(/€\s*\d[\d.,]*/) || txt.match(/^\d[\d.,]*\s*EUR/);
        });
        if (priceSpans.length > 0) preis = priceSpans[0].innerText.trim();
        if (priceSpans.length > 1) gesamtpreis = priceSpans[priceSpans.length - 1].innerText.trim();

        // Bewertung (z.B. "4,92" oder "4.92 (128)")
        let bewertung = '';
        let anzahlBewertungen = '';
        const ratingCandidates = allSpans.filter((el) => {
          const txt = el.innerText?.trim() ?? '';
          const lbl = el.getAttribute('aria-label') ?? '';
          return txt.match(/^[45][.,]\d{1,2}$/) || lbl.toLowerCase().includes('bewertu') || lbl.toLowerCase().includes('rating');
        });
        if (ratingCandidates.length > 0) {
          const ratingText = ratingCandidates[0].innerText.trim();
          const match = ratingText.match(/([45][.,]\d{1,2})\s*[(\s]*(\d+)?/);
          if (match) {
            bewertung = match[1];
            if (match[2]) anzahlBewertungen = match[2];
          } else {
            bewertung = ratingText;
          }
        }
        // Anzahl Bewertungen aus aria-label
        if (!anzahlBewertungen) {
          const reviewEl = card.querySelector('[aria-label*="Rezension"], [aria-label*="review"], [aria-label*="Bewertung"]');
          if (reviewEl) {
            const m = (reviewEl.getAttribute('aria-label') ?? '').match(/\d+/);
            if (m) anzahlBewertungen = m[0];
          }
        }

        // Superhost-Badge
        const superhostEl = card.querySelector('[aria-label*="Superhost"], [aria-label*="superhost"]');
        const superhost = superhostEl ? 'Ja' : '';

        // URL
        const linkEl = card.querySelector('a[href*="/rooms/"]') || card.querySelector('a');
        let url = linkEl?.href ?? '';
        if (url && !url.startsWith('http')) url = 'https://www.airbnb.de' + url;

        if (titel || preis) {
          results.push({ titel, unterzeile, preis, gesamtpreis, bewertung, anzahlBewertungen, superhost, url });
        }
      } catch (_) {
        // Einzelne Karte überspringen
      }
    });

    // Duplikate (gleiche URL) entfernen
    const seen = new Set();
    return results.filter((r) => {
      const key = r.url || r.titel;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
}

async function scrapeAirbnb() {
  if (!fs.existsSync(CONFIG.screenshotDir)) fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });

  const searchUrl =
    `https://www.airbnb.de/s/${encodeURIComponent(CONFIG.location)}/homes` +
    `?checkin=${CONFIG.checkin}&checkout=${CONFIG.checkout}` +
    `&adults=${CONFIG.adults}&currency=${CONFIG.currency}`;

  console.log('Starte Browser…');
  console.log(`Suchurl: ${searchUrl}`);

  const browser = await chromium.launch({
    headless: CONFIG.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--ignore-certificate-errors',
      '--window-size=1440,900',
    ],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'de-DE',
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'de-DE,de;q=0.9' },
  });

  // navigator.webdriver verstecken
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  const allListings = [];

  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 45000 });

    // Cookie-Banner schließen (mehrere Varianten)
    const cookieBtnSelectors = [
      'button[data-testid="accept-btn"]',
      'button:has-text("Alle akzeptieren")',
      'button:has-text("Accept all")',
      'button:has-text("Akzeptieren")',
      'button[id*="onetrust-accept"]',
    ];
    for (const sel of cookieBtnSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); console.log('Cookie-Banner geschlossen.'); break; }
      } catch (_) { /* weiter */ }
    }

    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(CONFIG.screenshotDir, 'seite_01.png'), fullPage: false });

    let pageNum = 1;
    while (pageNum <= CONFIG.maxPages) {
      console.log(`\nSeite ${pageNum} …`);

      // Bis zu 3 Versuche, bis Listings erscheinen
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await page.waitForSelector(
            '[data-testid="listing-card-wrapper"], [data-testid="card-container"], a[href*="/rooms/"]',
            { timeout: 15000 }
          );
          break;
        } catch (_) {
          if (attempt < 2) { await page.waitForTimeout(3000); }
        }
      }

      const pageListings = await extractListings(page);
      console.log(`  ${pageListings.length} Inserate gefunden.`);
      allListings.push(...pageListings);

      await page.screenshot({
        path: path.join(CONFIG.screenshotDir, `seite_${String(pageNum).padStart(2, '0')}.png`),
        fullPage: false,
      });

      // Nächste Seite
      const nextBtn = await page.$(
        'a[aria-label="Weiter"], a[aria-label="Next"], ' +
        'button[aria-label="Weiter"], button[aria-label="Next"], ' +
        'nav a[data-testid*="next"], [data-testid="pagination-next-btn"]'
      );
      if (!nextBtn) { console.log('Keine weitere Seite gefunden.'); break; }

      const isDisabled = await nextBtn.getAttribute('disabled') || await nextBtn.getAttribute('aria-disabled');
      if (isDisabled === 'true' || isDisabled === '') break;

      await nextBtn.click();
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => page.waitForTimeout(4000));
      pageNum++;
    }

    // Duplikate über alle Seiten entfernen
    const seen = new Set();
    const uniqueListings = allListings.filter((l) => {
      const key = l.url || l.titel;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (uniqueListings.length === 0) {
      const htmlPath = path.join(__dirname, 'debug_page.html');
      fs.writeFileSync(htmlPath, await page.content(), 'utf8');
      console.warn(`\nKeine Inserate gefunden. Seiten-HTML gespeichert: ${htmlPath}`);
      console.warn('Screenshots gespeichert in:', CONFIG.screenshotDir);
    } else {
      writeCsv(CONFIG.outputFile, uniqueListings);
      console.log(`\n✓ ${uniqueListings.length} Inserate exportiert → ${CONFIG.outputFile}`);
    }

  } finally {
    await browser.close();
  }
}

scrapeAirbnb().catch((err) => {
  console.error('\nFehler:', err.message);
  process.exit(1);
});
