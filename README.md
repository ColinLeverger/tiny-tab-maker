# 🎸 Tiny Tab Maker

A tiny **static** web app (no backend) that goes from a song's *structure* →
chords → tabs → **printable A4 PDF**. It's meant for prepping a band's play
sheets. Drop it on **GitHub Pages** and it just works.

It's the browser port of a little Python/reportlab script: same layout idea
(contents page, colour-coded arrangement map, chords tinted per section, real
ASCII tabs), but everything happens **in the page** — nothing to install.

## ⚠️ Honest disclaimer — read this first

This is **shaped around one person's very specific way of prepping guitar
parts** (mine). It is **opinionated and imprecise** on purpose:

- The tab model is deliberately simple — monophonic-ish riffs, hand-tweaked
  frets, ASCII output. It is **not** a real notation engine (no timing, no
  rhythm values, no multi-voice). If you need precision, use MuseScore /
  Guitar Pro / TuxGuitar.
- The section colour-coding guesses categories from keywords. It's "good
  enough", not exact.
- The jsPDF download folds Unicode arrows to ASCII; the **Print → Save as PDF**
  path is the faithful one.

That said, it's **genuinely handy for quickly prototyping** a clean, readable
song-sheet booklet you can print and scribble on. Take it as a starting point,
fork it, bend it to your own workflow. PRs welcome but no promises — it's a
weekend tool, not a product.

The data shipped in the repo is **100% fictional** (a made-up band). Your real
tabs never get committed — see [Privacy](#privacy).

---

## Quick start

No build step. It's plain HTML/CSS/JS.

```bash
# either
python3 -m http.server 8000      # then http://localhost:8000
# or just open index.html in a browser
```

A demo songbook loads on first open. Edit on the left, the preview updates on
the right, then **Generate**.

## Two ways to get a PDF

| Button | Engine | Output |
|---|---|---|
| **PDF colour / B&W** | jsPDF (vector) | direct `.pdf` download. Courier for the tabs; arrows `→ ↓ ‖` are folded to ASCII (`-> v \|\|`) because jsPDF's standard fonts are WinAnsi. |
| **Print / Save as PDF** | browser (`window.print`) | prints the preview as A4 via `@media print` CSS. **Keeps all Unicode**, most faithful. Pick "Save as PDF" in the print dialog. |

The **B&W** checkbox switches the preview (and colour→B&W PDF) to grayscale for
printers with no colour. **Compact** packs several songs per page (and never
splits a song across two pages). **Size** sets the chord + tab text size.

## Deploy to GitHub Pages

**Option A — Pages from a branch** (simplest)
1. Push this repo to GitHub.
2. *Settings → Pages → Build and deployment → Source: Deploy from a branch*,
   branch `main`, folder `/ (root)`.
3. Served at `https://<user>.github.io/tiny-tab-maker/`.

**Option B — GitHub Actions**: the `.github/workflows/deploy.yml` workflow is
included. Set *Settings → Pages → Source: GitHub Actions* and every push to
`main` redeploys.

`.nojekyll` disables Jekyll processing.

---

## Privacy

- The app **autosaves** to `localStorage` (key `fg_fiches_state_v1`). Nothing
  hits the network (jsPDF/autotable load from a CDN; everything else is local).
- **Data → Export JSON** to back up / move; **Import JSON** to reload. It's
  *your* file — keep it **outside the repo**.
- `.gitignore` already blocks `fiches-data*.json`, `songbook-data*.json`,
  `*.local.json`, `*.private.*` and a `private/` folder.
- The only committed dataset is `js/demo-data.js`, which is **invented**.

To publish *your* real songbook, use a **private** repo, or keep the repo public
and only load real data locally.

## Architecture

```
index.html          page shell + script loading
css/styles.css      UI + preview "sheets" + A4 print rules
js/data.js          pure logic: section classifier + ASCII tab renderer (Node-testable)
js/demo-data.js     the fictional sample data
js/render.js        HTML preview (= what the Print mode lays out)
js/pdf.js           vector PDF generation (jsPDF + autotable)
js/app.js           state, editor, grid tab editor, persistence, import/export
.github/workflows/deploy.yml   Pages deploy (option B)
```

`data.js` and `demo-data.js` are UMD, so they also run under Node — the logic
can be unit-tested without a browser.

## Data model

```jsonc
{
  "meta": { "band": "...", "subtitle": "...", "notation": "...", "updated": "2026-06-24" },
  "songs": [{
    "num": "01", "title": "...", "group": "Album",
    "key": "Em", "tempo": "~120 BPM", "meter": "4/4", "feel": "funk",
    "structure": "Intro → Verse → Chorus → Solo → Ending",
    "chords": [{ "label": "Verse", "value": "Em G D C" }],
    "riffs":  [{ "label": "Riff", "note": "×4", "tab": [ ["E",0],["bar"],["repclose",4] ] }],
    "breaks": "N/A", "notes": "..."
  }]
}
```

### Tab event format

Strings (top→bottom): `e B G D A E`.

| Event | Meaning | Renders |
|---|---|---|
| `["E",6]` | note: (string, fret) | `6` on string E |
| `["E","(3)"]` | fret as text (e.g. muted note) | `(3)` |
| `["bar"]` | bar line | `\|` |
| `["repopen"]` | repeat open | `\|:` |
| `["repclose"]` / `["repclose",4]` | repeat close (+ count) | `:\|` (the ×4 goes in the note) |
| `["mark"]` | point marker | `‡` |

A riff with no `tab` (`null`/empty) prints a **blank 6×8 grid** to fill by hand.

### Arrangement map (colours)

Each `structure` section and each chord row is classified by keyword
(`intro`, `chorus/refrain`, `verse/couplet`, `solo`, `break`, `brass/cuivres`,
`riff/power`, `gypsy/funk/reggae…`, `bridge`, `end/outro`) then tinted. Keys
accept **English and French**, so the colours still match French section names.
Palette and priority live in `js/data.js` (`CATEGORIES` / `PRIORITY`).

## Test the logic (no browser)

```bash
node -e "const FG=require('./js/data.js');
  console.log(FG.tabToText([['E',6],['E',8],['bar'],['A',5]]));
  console.log(FG.classify('Break solo').key);"
```

## License

MIT — see [LICENSE](LICENSE). Built by Colin Leverger as a personal prototyping
tool; use it however you like.
