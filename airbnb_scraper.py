"""
Airbnb-Scraper: Ostfildern-Scharnhausen
Check-in: 22.05.2026 | Check-out: 24.05.2026

Installation:
    pip install playwright
    playwright install chromium

Ausführung:
    python airbnb_scraper.py

Ausgabe: airbnb_ergebnisse.csv
"""

import csv
import os
import re
from playwright.sync_api import sync_playwright

LOCATION  = os.getenv("AIRBNB_LOCATION", "Ostfildern-Scharnhausen")
CHECKIN   = os.getenv("AIRBNB_CHECKIN",  "2026-05-22")
CHECKOUT  = os.getenv("AIRBNB_CHECKOUT", "2026-05-24")
MAX_PAGES = 10
OUTFILE   = os.path.join(os.path.dirname(__file__), "airbnb_ergebnisse.csv")


def extract_listings(page):
    return page.evaluate("""() => {
        const results = [];

        let cards = [];
        for (const sel of [
            '[data-testid="listing-card-wrapper"]',
            '[data-testid="card-container"]',
            'div[class*="g1qv1ctd"]',
        ]) {
            cards = [...document.querySelectorAll(sel)];
            if (cards.length) break;
        }

        // Fallback: Eltern-Container von Zimmer-Links
        if (!cards.length) {
            const seen = new Set();
            for (const a of document.querySelectorAll('a[href*="/rooms/"]')) {
                const c = a.closest('div[class]') || a.parentElement;
                if (c && !seen.has(c)) { seen.add(c); cards.push(c); }
            }
        }

        cards.forEach(card => {
            try {
                // Titel
                const titleEl =
                    card.querySelector('[data-testid="listing-card-title"]') ||
                    card.querySelector('div[class*="t1jojoys"]') ||
                    card.querySelector('h3') || card.querySelector('h2');
                const titel = titleEl?.innerText?.trim() ?? "";

                // Unterzeile
                const subEl =
                    card.querySelector('[data-testid="listing-card-subtitle"]') ||
                    card.querySelector('div[class*="fb4nyux"]');
                const unterzeile = subEl?.innerText?.trim() ?? "";

                // Preise (alle Textelemente mit €)
                const priceEls = [...card.querySelectorAll('span,div')]
                    .filter(el => /\\d[\\d.,]*\\s*€|€\\s*\\d/.test(el.innerText ?? ""));
                const preis        = priceEls[0]?.innerText?.trim() ?? "";
                const gesamtpreis  = priceEls.length > 1
                    ? priceEls[priceEls.length - 1].innerText.trim() : "";

                // Bewertung
                let bewertung = "", anzahl = "";
                const ratingEl = [...card.querySelectorAll('span,div')]
                    .find(el => /^[45][.,]\\d{1,2}$/.test(el.innerText?.trim() ?? ""));
                if (ratingEl) {
                    bewertung = ratingEl.innerText.trim();
                    const next = ratingEl.nextElementSibling;
                    if (next) {
                        const m = next.innerText.match(/\\d+/);
                        if (m) anzahl = m[0];
                    }
                }
                if (!anzahl) {
                    const rl = card.querySelector(
                        '[aria-label*="Rezension"],[aria-label*="review"],[aria-label*="Bewertung"]');
                    if (rl) { const m = rl.getAttribute('aria-label').match(/\\d+/); if (m) anzahl = m[0]; }
                }

                // Superhost
                const superhost = card.querySelector(
                    '[aria-label*="Superhost"],[aria-label*="superhost"]') ? "Ja" : "";

                // URL
                const a = card.querySelector('a[href*="/rooms/"]') || card.querySelector('a');
                let url = a?.href ?? "";
                if (url && !url.startsWith("http")) url = "https://www.airbnb.de" + url;

                if (titel || preis) results.push(
                    {titel, unterzeile, preis, gesamtpreis, bewertung, anzahl, superhost, url});
            } catch(_) {}
        });

        // Duplikate entfernen — nach Room-ID, nicht voller URL
        const seen = new Set();
        return results.filter(r => {
            const roomId = (r.url || '').match(/\/rooms\/(\d+)/)?.[1];
            const k = roomId || r.url || r.titel;
            if (seen.has(k)) return false;
            seen.add(k); return true;
        });
    }""")


def save_csv(rows):
    fieldnames = ["Titel", "Unterzeile", "Preis_pro_Nacht", "Gesamtpreis",
                  "Bewertung", "Anzahl_Bewertungen", "Superhost", "URL"]
    with open(OUTFILE, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            writer.writerow({
                "Titel":              r.get("titel", ""),
                "Unterzeile":         r.get("unterzeile", ""),
                "Preis_pro_Nacht":    r.get("preis", ""),
                "Gesamtpreis":        r.get("gesamtpreis", ""),
                "Bewertung":          r.get("bewertung", ""),
                "Anzahl_Bewertungen": r.get("anzahl", ""),
                "Superhost":          r.get("superhost", ""),
                "URL":                r.get("url", ""),
            })


def main():
    url = (
        f"https://www.airbnb.de/s/{LOCATION.replace(' ', '-')}/homes"
        f"?checkin={CHECKIN}&checkout={CHECKOUT}&adults=1&currency=EUR"
    )
    print(f"Suche: {url}\n")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
        )
        ctx = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="de-DE",
            viewport={"width": 1440, "height": 900},
            extra_http_headers={"Accept-Language": "de-DE,de;q=0.9"},
        )
        ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
        )
        page = ctx.new_page()

        page.goto(url, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(6000)

        # Cookie-Banner schließen
        for sel in [
            'button[data-testid="accept-btn"]',
            'button:has-text("Alle akzeptieren")',
            'button:has-text("Accept all")',
            'button:has-text("Akzeptieren")',
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=3000):
                    btn.click()
                    print("Cookie-Banner geschlossen.")
                    break
            except Exception:
                pass

        all_listings = []
        seen_keys = set()

        for page_num in range(1, MAX_PAGES + 1):
            print(f"Seite {page_num} …", end=" ", flush=True)

            # Warten bis Karten geladen
            for _ in range(3):
                try:
                    page.wait_for_selector(
                        '[data-testid="listing-card-wrapper"],'
                        '[data-testid="card-container"],'
                        'a[href*="/rooms/"]',
                        timeout=12000,
                    )
                    break
                except Exception:
                    page.wait_for_timeout(3000)

            listings = extract_listings(page)

            # Seitenübergreifende Duplikate entfernen
            new = []
            for l in listings:
                k = l.get("url") or l.get("titel")
                if k and k not in seen_keys:
                    seen_keys.add(k)
                    new.append(l)

            all_listings.extend(new)
            print(f"{len(new)} neu ({len(all_listings)} gesamt)")

            # Nächste Seite suchen
            next_btn = page.locator(
                'a[aria-label="Weiter"], a[aria-label="Next"], '
                '[data-testid="pagination-next-btn"]'
            ).first
            try:
                if not next_btn.is_visible(timeout=3000):
                    break
                disabled = next_btn.get_attribute("disabled") or next_btn.get_attribute("aria-disabled")
                if disabled in ("true", ""):
                    break
                next_btn.click()
                page.wait_for_load_state("domcontentloaded", timeout=20000)
                page.wait_for_timeout(4000)
            except Exception:
                break

        browser.close()

    if not all_listings:
        print("\nKeine Inserate gefunden.")
        print("Tipp: Prüfe ob Airbnb für diesen Ort Ergebnisse liefert.")
        save_csv([])
        print(f"Leere CSV mit Spaltenköpfen geschrieben → {OUTFILE}")
        return

    save_csv(all_listings)
    print(f"\n{len(all_listings)} Inserate gespeichert → {OUTFILE}")
    print("Datei kann direkt in Excel geöffnet werden.")


if __name__ == "__main__":
    import sys
    import traceback
    try:
        main()
    except Exception:
        print("\n!!! FEHLER im Scraper !!!", flush=True)
        traceback.print_exc()
        save_csv([])
        print(f"Leere CSV nach Fehler geschrieben → {OUTFILE}", flush=True)
        sys.exit(1)
