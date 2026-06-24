# legacy-python — the original generator (reference)

This is the **original Python/reportlab script** that **Tiny Tab Maker** was
ported from. It's kept here for reference: same idea (contents page, colour
arrangement map, chords tinted per section, real ASCII tabs), but it builds the
PDF from two plain files instead of a browser.

It still works — it runs on the **fictional sample** included here. Nothing in
this folder is real data.

> Note: the script keeps its original **French prose and field labels**
> (`Tonalité`, `Mesure`, …) on purpose — it's the historical artefact. The web
> app is the English, interactive successor. Only the band identity was
> genericised (`DEMO BAND`).

## Run it

```bash
cd legacy-python
pip install reportlab                 # once
python3 build_pdf.py 12 demo_sheets-color.pdf map        # colour
python3 build_pdf.py 12 demo_sheets-bw.pdf  map bw       # black & white
# or: make        (needs `make`)
```

Args: `[chord_pt] [output_path] [map] [bw]`. `map` adds the colour arrangement
roadmap; `bw` switches it to grayscale.

## Files

```
build_pdf.py     generator (reportlab); paths are relative to this folder
sample_prep.txt  FICTIONAL source: 3 songs (key, tempo, structure, chords, riffs)
tabs_data.py     FICTIONAL validated tabs, keyed by (song number, placeholder label)
Makefile         shortcuts (make / make color / make bw / make clean)
```

## How the source format works

- One block per song, started by a header line `NN — TITLE (group)`.
- Fields are `Label : value`. A `Chords` block lists `section : chords` rows.
- Each `[TAB PLACEHOLDER]` becomes a tab: filled from `tabs_data.py` if a
  matching `(number, label)` key exists, otherwise printed as a **blank 6×8
  grid** to fill by hand (see song 03).

The web app uses the **same tab event format** (`('E',6)`, `('bar',)`,
`('repopen',)`, `('repclose',n)`, `('mark',)`), so data converts between the two
almost 1:1.

## Dependencies

Python 3 + `reportlab`. Optional DejaVu fonts for nicer `→ ↓ × ‖` glyphs
(falls back to ASCII automatically).
