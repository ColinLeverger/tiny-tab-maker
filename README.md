# 🎸 Tiny Tab Maker

https://colinleverger.github.io/tiny-tab-maker/

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

## Rehearsal mode (phone / tablet)

The **📖 View** button gives a full-screen, one-song-per-screen reading view.
On portrait phones the layout mimics the editor preview: text keeps its size
and wraps, each ASCII tab shrinks its own font to fit, and the sheet width is
iterated until its shape matches the screen — then one uniform zoom fills the
screen exactly (always ONE page, biggest zoom that fits). Landscape/desktop
scales the A4 page to fit one screen. On top of it:

- **Tap a section pill** (or the **🖍** button for the whole song) → a bottom
  sheet opens: mark the section **red** (needs work) / **yellow** (so-so) and
  **push notes**: type, hit *＋ Push* (or Enter), the field blanks for the next
  one. Notes stack up numbered **#01, #02…**; tap a row to pull it back for
  editing (it returns to its slot), ✕ deletes it. Chips at the top retarget to
  any other section without losing a half-typed draft. Marks show as dots on
  the pills and in a numbered "Rehearsal" block on the sheet — **on screen
  only, never printed** (they're your scribbles, not the band's booklet). They
  are editable/deletable from the song card in the editor too, and they travel
  inside Export JSON and share links like everything else.
- **☰** opens the setlist: tap a song to jump to it, big **▲▼** to reorder
  (plays nice with Auto-№). The picker at the top switches between the
  **whole book and named setlists** — a setlist is an ordered subset of the
  book (stored by stable song ids, so reordering the book never breaks a set).
  ＋ New creates one, − / ＋ move songs in and out, 🗑 deletes the list (songs
  stay).
- **View scope**: the active set is a *lens* over the book. The topbar
  switcher (📕 Whole book / 📗 set name — tinted blue when scoped, mirrored in
  ☰) drives **the preview pane, Print, PDF export and View mode alike**: set
  songs only, set order, renumbered 01..n, cover page turned into a setlist
  cover. The Generate menu labels say what they'll produce. The **editor
  always shows the whole book** (▸03 badge = position in the active set,
  ∅ = not in it), so no song ever gets "lost" again — scope is a lens, never
  a knife. Workflow: edit in 📕 → build the set in ☰ → switch to 📗 → reorder,
  rehearse, print the set PDF → flip back to 📕 for the full booklet.
- **🖍 Practice digest** (Generate menu): every mark & note in the book on one
  page, red-first per song — the "what to fix at home" list. Printable on
  demand (unlike the per-sheet scribbles, which never print).
- **🖍 Review notes** (button on the Editor header, with live count): the
  digest's action twin — an inbox-zero queue that shows one note at a time
  (with its voice memos, playable), lets you fix Tempo / Key / the matching
  chord line / song notes **in place**, then *✓ Fixed* clears the note and
  slides the next in; *Keep ›* skips, ✕ deletes single note lines, and
  "open full card" bails out to the editor for bigger surgery. One undo step
  per reviewed entry.
- **🥁 Tap** (top bar, or in ☰ preset to the current song's tempo) opens
  `tap.html`: a full-screen tap-tempo pad + Web Audio metronome with accented
  downbeat (2/4 · 3/4 · 4/4 · 6/8), `?bpm=` preset, zero dependencies.
  There's also a **🥁 next to each song's Tempo field** in the editor: it opens
  a big fixed tap pad (thumb-sized) — tap the beat, then *Done*, 10 s cap or a
  2.5 s pause writes `~<bpm> BPM` into the field (min 3 taps); *Cancel*,
  scrolling or focusing another field dismisses it.
  Setlists are reachable from the editor too via **☰ Sets** in the top bar
  (tapping a song there opens its card instead of jumping stage view).
- **🎤 Voice memos** (in the rehearsal sheet): record up to 5 min per take,
  attached to the current section chip; ▶ playback rows, 🎤 badges on chips.
  Stored **on-device in IndexedDB** — never in localStorage, the share URL or
  any server — and **auto-deleted after 30 days** (`MEMO_TTL_DAYS` in app.js),
  along with memos of deleted songs, so a phone never silts up. To move them:
  *Data → Export incl. voice memos* (share sheet / AirDrop on iPhone, file
  download elsewhere); importing that file rehydrates them. Recording holds a
  screen wake-lock — a locked phone kills the mic.
- **PWA / offline**: the app ships a manifest + service worker. Visit once
  online, then *Add to Home Screen* — it opens full-screen and works with **no
  network at all** (CDN libs get runtime-cached too). Bump `VERSION` in `sw.js`
  when deploying changes.
- **🔗 Share** (in ☰, or Data → *Copy share link*) puts the **whole songbook,
  compressed, in the URL fragment** (`#d=…`, lz-string). Open that link in any
  browser/device and it offers to import — no backend, and the fragment never
  reaches the server. A link shared from View mode also carries `&s=<n>` so it
  opens straight on that song. Typical size: a 30-song book ≈ 8 KB of URL.

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
tap.html            standalone tap-tempo + metronome page (no dependencies)
css/styles.css      UI + preview "sheets" + A4 print rules
js/data.js          pure logic: section classifier + ASCII tab renderer (Node-testable)
js/demo-data.js     the fictional sample data
js/render.js        HTML preview (= what the Print mode lays out)
js/pdf.js           vector PDF generation (jsPDF + autotable)
js/app.js           state, editor, grid tab editor, rehearsal/setlists/share, persistence
sw.js               offline-first service worker (bump VERSION on deploy)
manifest.webmanifest / icons/   PWA install (Add to Home Screen)
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
    "breaks": "N/A", "notes": "...",
    "rehearsal": { "Chorus": { "c": "red", "note": "slower!" }, "__song": { "note": "capo 2" } }
  }]
}
```

`rehearsal` is optional (rehearsal-mode marks/notes, keyed by section pill text,
`__song` = whole song; `c` is `"red"` or `"yellow"`; `note` holds the pushed
notes, one per line). It's screen-only — the PDF and print paths ignore it
(except the opt-in Practice digest).

Each song also gets an auto-generated stable `id`, and the root may carry
`"setlists": [{ "name": "Gig X", "songs": ["<id>", …] }]` plus `"activeSet"`
(index or `null`). Everything rides along in Export JSON and share links.

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
| `["nl"]` | forced line skip — wrap to a new block right here | (new 6-line block) |
| `["chord", [["E",3],["A",5]]]` | several notes at the same time | stacked in one column |

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
