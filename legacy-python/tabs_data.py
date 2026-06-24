# -*- coding: utf-8 -*-
"""
Validated tab data (FICTIONAL sample) — imported by build_pdf.py to fill the
[TAB PLACEHOLDER] markers in sample_prep.txt.

Event format:
  ('E', 6)        note: (string, fret)     strings = e B G D A E
  ('E', '(3)')    fret as text (e.g. parentheses = muted note)
  ('bar',)        bar line                 ->  |
  ('repopen',)    repeat open              ->  ‖:
  ('repclose',)   repeat close             ->  :‖
  ('repclose', n) repeat close + count     ->  :‖×n
  ('mark',)       point marker             ->  ‡

Key = (song_number, placeholder_label). NOTES[key] = annotation next to the tab.
Nothing here is real — invented riffs for the demo band.
"""

TABS = {}
NOTES = {}

# 01 COSMIC WAKE-UP — intro motif
TABS[("01", "Riff")] = [
    ('E', 0), ('E', 3), ('E', 5), ('bar',),
    ('A', 0), ('A', 3), ('A', 5), ('bar',),
    ('E', 0), ('E', 3), ('E', 5), ('E', 3), ('bar',),
    ('E', 0),
]
NOTES[("01", "Riff")] = "intro motif, ×2"

# 02 SWEET POTATO — funk riff, ×4 (final (5) muted on the last pass)
TABS[("02", "Riff")] = [
    ('repopen',),
    ('D', 5), ('D', 7), ('D', 5), ('G', 5), ('bar',),
    ('D', 5), ('D', 7), ('D', 5), ('G', 7), ('G', 7), ('G', '(5)'),
    ('repclose', 4),
]
NOTES[("02", "Riff")] = "×4 — the final (5) is muted on the last pass"

# 03 MORNING FOG — intentionally no tab here -> build_pdf.py prints a blank 6×8 grid.
