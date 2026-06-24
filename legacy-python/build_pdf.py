#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Demo Band — printable guitar sheets (A4). Reference generator for Tiny Tab Maker."""
import re, os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, KeepTogether, PageBreak, Flowable, Preformatted)
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

import sys
sys.dont_write_bytecode = True   # keep the folder clean (no __pycache__)
from datetime import date
GEN_DATE = date.today().isoformat()
# Portable: source + outputs live next to this script.
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "sample_prep.txt")
OUT = os.path.join(HERE, "demo_sheets.pdf")
# optional CLI: argv[1]=chord font size (pt), argv[2]=output path (abs or relative to CWD)
CHORD_PT = float(sys.argv[1]) if len(sys.argv) > 1 else 8.4
if len(sys.argv) > 2:
    OUT = sys.argv[2]
# argv[3]='map' -> visual structure roadmap (v3)
VISUAL = len(sys.argv) > 3 and sys.argv[3].lower() in ("map", "visual", "v3", "struct")
# argv[4]='bw' -> grayscale version for black & white printers
BW = len(sys.argv) > 4 and sys.argv[4].lower() in ("bw", "b&w", "nb", "n&b", "gray", "grey")

# validated tab data (next to this script)
sys.path.insert(0, HERE)
try:
    import tabs_data
    TABS = getattr(tabs_data, "TABS", {})
    NOTES = getattr(tabs_data, "NOTES", {})
except Exception:
    TABS, NOTES = {}, {}

# ---------- fonts ----------
DV_DIR = "/usr/share/fonts/truetype/dejavu"
def _reg(name, fn):
    p = os.path.join(DV_DIR, fn)
    if os.path.exists(p):
        pdfmetrics.registerFont(TTFont(name, p)); return True
    return False
HAVE = (_reg("DV","DejaVuSans.ttf") and _reg("DVB","DejaVuSans-Bold.ttf")
        and _reg("DVO","DejaVuSans-Oblique.ttf"))
_reg("DVM","DejaVuSansMono.ttf")
if HAVE:
    registerFontFamily("DV", normal="DV", bold="DVB", italic="DVO", boldItalic="DVB")
    F, FB, FO = "DV", "DVB", "DVO"
else:
    F, FB, FO = "Helvetica", "Helvetica-Bold", "Helvetica-Oblique"

def san(s):
    if s is None: return ""
    s = s.replace("∥", "||")          # ∥ -> ||  (glyph-safe)
    if not HAVE:                           # ascii fallback if DejaVu missing
        for a, b in [("—","-"),("–","-"),("→","->"),("↔","<->"),
                     ("↓","v"),("…","..."),("×","x"),("’","'")]:
            s = s.replace(a, b)
    return (s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;"))

# ---------- parse ----------
raw = open(SRC, encoding="utf-8").read().splitlines()
HDR = re.compile(r'^\s*(\d{2})\s+—\s+(.*)$')
PH  = re.compile(r'\[TAB PLACEHOLDER\s*(?:—\s*([^\]]*))?\]')
songs, cur, mode, last_update = [], None, None, ""
for line in raw:
    if line.startswith("Dernière mise à jour"):
        last_update = line.split(":", 1)[1].strip()
    m = HDR.match(line)
    if m:
        rest = m.group(2).strip(); grp = ""; title = rest
        gm = re.search(r'\(([^)]*)\)\s*$', rest)
        if gm:
            grp = gm.group(1).strip(); title = rest[:gm.start()].strip()
        cur = dict(num=m.group(1), title=title, group=grp, fields=[], chords=[])
        songs.append(cur); mode = None
        continue
    if cur is None or re.match(r'^[-=]{3,}\s*$', line) or line.strip() == "":
        continue
    if re.match(r'^Chords\b', line):
        mode = "chords"; continue
    if re.match(r'^\s{2,}\S', line) and mode == "chords":
        if ":" in line:
            lab, val = line.split(":", 1); cur["chords"].append((lab.strip(), val.strip()))
        else:
            cur["chords"].append(("", line.strip()))
        continue
    if ":" in line:
        k, v = line.split(":", 1); cur["fields"].append((k.strip(), v.strip()))
    else:
        cur["fields"].append((line.strip(), ""))
    mode = None

# ---------- placeholders -> grids ----------
for s in songs:
    grids = []
    nc = []
    for lab, val in s["chords"]:
        m = PH.search(val)
        if m:
            cap = lab or "Riff"; extra = (m.group(1) or "").strip()
            large = "large" in extra.lower()
            if extra and not large: cap = f"{cap} — {extra}"
            grids.append((cap, large))
            nc.append((lab, PH.sub("(grille ci-dessous)", val).strip()))
        else:
            nc.append((lab, val))
    s["chords"] = nc
    nf = []
    for k, v in s["fields"]:
        m = PH.search(v)
        if m:
            extra = (m.group(1) or "").strip(); large = "large" in extra.lower()
            cap = "Riff" if (not extra or large) else f"Riff — {extra}"
            grids.append((cap, large))
            nf.append((k, PH.sub("(grille ci-dessous)", v).strip() or "(grille ci-dessous)"))
        else:
            nf.append((k, v))
    s["fields"] = nf
    s["grids"] = grids

def fget(s, name):
    for k, v in s["fields"]:
        if k.lower() == name.lower(): return v
    return None

# ---------- styles ----------
title_s = ParagraphStyle("t", fontName=FB, fontSize=27, leading=30, textColor=colors.HexColor("#1b2540"))
subt_s  = ParagraphStyle("s", fontName=FO, fontSize=12, leading=15, textColor=colors.HexColor("#555555"))
note_s  = ParagraphStyle("n", fontName=F, fontSize=8.6, leading=12, textColor=colors.HexColor("#555555"))
body_s  = ParagraphStyle("b", fontName=F, fontSize=8.6, leading=11)
struct_small = ParagraphStyle("ss", fontName=F, fontSize=7.6, leading=9.6, textColor=colors.HexColor("#777777"))
cell_s  = ParagraphStyle("c", fontName=F, fontSize=8.4, leading=10.2)
chlab_s = ParagraphStyle("chl", fontName=FB, fontSize=min(CHORD_PT, 9.5), leading=min(CHORD_PT, 9.5)*1.18)
chval_s = ParagraphStyle("chv", fontName=FB, fontSize=CHORD_PT, leading=CHORD_PT*1.2)
sub_s   = ParagraphStyle("sub", fontName=FB, fontSize=8.4, leading=10, textColor=colors.HexColor("#1b2540"))
cap_s   = ParagraphStyle("cap", fontName=FB, fontSize=8.3, leading=10, textColor=colors.HexColor("#1b2540"))
hl_s    = ParagraphStyle("hl", fontName=FB, fontSize=10.5, leading=12, textColor=colors.black)
hr_s    = ParagraphStyle("hr", fontName=F, fontSize=8.4, leading=11, alignment=TA_RIGHT, textColor=colors.HexColor("#222222"))
cth_s   = ParagraphStyle("cth", fontName=FB, fontSize=8.6, leading=10)
cbd_s   = ParagraphStyle("cbd", fontName=F, fontSize=8.8, leading=10.5)
cgr_s   = ParagraphStyle("cgr", fontName=FB, fontSize=8.8, leading=11, textColor=colors.HexColor("#1b2540"))

USABLE = 186 * mm

# ---------- real ASCII tab rendering ----------
MONO = "DVM" if os.path.exists(os.path.join(DV_DIR, "DejaVuSansMono.ttf")) else "Courier"
TAB_PT = 13
mono_s = ParagraphStyle("mono", fontName=MONO, fontSize=TAB_PT, leading=TAB_PT*1.16)
_STR6 = ["e", "B", "G", "D", "A", "E"]
def _tok(ev):
    tag = ev[0]
    if tag == "bar": return "|"
    if tag == "repopen": return "‖:"
    if tag == "repclose": return ":‖" + ("×"+str(ev[1]) if len(ev) > 1 else "")
    if tag == "mark": return "‡"
    return None
def _tab_cols(events):
    cols = []
    for ev in events:
        tok = _tok(ev)
        if tok is not None:
            cols.append({s: tok for s in _STR6})
        else:
            st, fr = ev; c = str(fr)
            cols.append({s: (c if s == st else "-"*len(c)) for s in _STR6})
    return cols
def tab_chunks(events, maxw=USABLE):
    cols = _tab_cols(events)
    cw = pdfmetrics.stringWidth("0", MONO, TAB_PT)
    maxchars = max(24, int((maxw - 4*mm) / cw))
    chunks, cur, curlen = [], [], 5  # 'e|-' + '-|'
    for col in cols:
        w = len(next(iter(col.values()))) + 1
        if cur and curlen + w > maxchars:
            chunks.append(cur); cur, curlen = [], 5
        cur.append(col); curlen += w
    if cur: chunks.append(cur)
    return ["\n".join(f"{s}|-" + "-".join(col[s] for col in ch) + "-|" for s in _STR6)
            for ch in chunks]

# ---------- structure roadmap (v3) ----------
CAT_COLORS = {
    "intro":  ("#D7E6FB", "#3F6FB5"),
    "verse":  ("#DBEFD6", "#4E9A4A"),
    "chorus": ("#F9D4C2", "#D2683A"),
    "break":  ("#E7DBF6", "#7E5CC0"),
    "solo":   ("#FBD3E8", "#C7559A"),
    "brass":  ("#FBEBBC", "#C39A1E"),
    "feel":   ("#CFECE6", "#3FA08E"),
    "riff":   ("#DBE2EC", "#5B6B86"),
    "bridge": ("#DADDF6", "#5560C0"),
    "ending": ("#D5DAE1", "#49515F"),
    "section":("#ECECEC", "#9A9A9A"),
}
# grayscale palette for B&W printers — 11 distinguishable shades (decoded by the cover legend)
CAT_GRAYS = {
    "intro":  ("#FFFFFF", "#222222"),
    "verse":  ("#E4E4E4", "#222222"),
    "chorus": ("#CFCFCF", "#222222"),
    "break":  ("#BBBBBB", "#222222"),
    "solo":   ("#A6A6A6", "#222222"),
    "brass":  ("#DADADA", "#222222"),
    "feel":   ("#969696", "#111111"),
    "riff":   ("#7C7C7C", "#111111"),
    "bridge": ("#686868", "#111111"),
    "ending": ("#4A4A4A", "#111111"),
    "section":("#EDEDED", "#222222"),
}
def cat_fb(cat):
    pal = CAT_GRAYS if BW else CAT_COLORS
    return pal.get(cat, pal["section"])
def text_on(hexfill):
    h = hexfill.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return "#FFFFFF" if (0.299*r + 0.587*g + 0.114*b) < 145 else "#222222"
CAT_LABEL = {
    "intro":"Intro", "verse":"Couplet", "chorus":"Refrain / Chorus", "break":"Break",
    "solo":"Solo", "brass":"Cuivres", "feel":"Feel (gypsy/funk/reggae…)",
    "riff":"Riff / powerchords", "bridge":"Bridge", "ending":"Fin / Ending",
    "section":"Autre section",
}
def plain(s):
    s = (s or "").replace("∥", "||")
    if not HAVE:
        for a, b in [("—","-"),("–","-"),("→","->"),("↔","<->"),("↓","v"),
                     ("…","..."),("×","x"),("’","'")]:
            s = s.replace(a, b)
    return s
def classify(name):
    n = name.lower()
    if "intro" in n: return "intro"
    if "chorus" in n or "refrain" in n: return "chorus"
    if any(k in n for k in ("couplet", "verse", "chant")): return "verse"
    if "solo" in n: return "solo"
    if "break" in n: return "break"
    if any(k in n for k in ("cuivre", "trompette", "brass")) or re.search(r"\btrp\b", n): return "brass"
    if any(k in n for k in ("riff", "power")): return "riff"
    if any(k in n for k in ("gypsy","gipsy","funk","reggae","cumbia","jazz","swing","contretemps","offbeat")): return "feel"
    if "bridge" in n: return "bridge"
    if re.search(r"\b(fin|finale?|ending|outro)\b", n): return "ending"
    return "section"
def split_structure(st):
    return [p.strip() for p in st.split("→") if p.strip()]
def chip_label(seg):
    s = re.sub(r"\([^)]*\)", "", seg).strip(" -–—")
    return plain(s if s else seg.strip())

class SectionMap(Flowable):
    def __init__(self, segs, maxwidth):
        Flowable.__init__(self)
        self.segs = segs; self.maxwidth = maxwidth
        self.fs = 8.2; self.padx = 2.6*mm; self.h = 6.6*mm
        self.vgap = 1.7*mm; self.hgap = 3.2*mm
    def _measure(self):
        rows, row, x = [], [], 0.0
        for label, cat in self.segs:
            w = min(pdfmetrics.stringWidth(label, FB, self.fs) + 2*self.padx, self.maxwidth)
            if row and x + self.hgap + w > self.maxwidth:
                rows.append(row); row, x = [], 0.0
            if row: x += self.hgap
            row.append((label, cat, x, w)); x += w
        if row: rows.append(row)
        self._rows = rows; return rows
    def wrap(self, availw, availh):
        self.maxwidth = min(self.maxwidth, availw)
        rows = self._measure()
        self.width = self.maxwidth
        self.height = (len(rows)*self.h + (len(rows)-1)*self.vgap) if rows else 0
        return (self.width, self.height)
    def draw(self):
        c = self.canv; H = self.height
        for ri, row in enumerate(self._rows):
            y = H - (ri+1)*self.h - ri*self.vgap
            for i, (label, cat, x, w) in enumerate(row):
                fill, border = cat_fb(cat)
                c.setFillColor(colors.HexColor(fill)); c.setStrokeColor(colors.HexColor(border))
                c.setLineWidth(0.8); c.roundRect(x, y, w, self.h, 1.6*mm, stroke=1, fill=1)
                c.setFillColor(colors.HexColor(text_on(fill) if BW else "#222222")); c.setFont(FB, self.fs)
                c.drawCentredString(x + w/2.0, y + self.h/2.0 - self.fs*0.34, label)
                if i < len(row) - 1:
                    c.setFillColor(colors.HexColor("#9a9a9a")); c.setFont(FB, self.fs)
                    c.drawCentredString(x + w + self.hgap/2.0, y + self.h/2.0 - self.fs*0.34, "›")

# ---------- tab grid ----------
STR = ["e", "B", "G", "D", "A", "E"]
LBL_W, CELL_W, ROW_H, HEAD_H = 8*mm, 20*mm, 5.2*mm, 4.0*mm
def one_grid():
    data = [[""] + [str(i) for i in range(1, 9)]]
    for nm in STR:
        data.append([nm] + [""]*8)
    t = Table(data, colWidths=[LBL_W] + [CELL_W]*8, rowHeights=[HEAD_H] + [ROW_H]*6)
    t.setStyle(TableStyle([
        ("GRID", (1,1), (-1,-1), 0.4, colors.HexColor("#8a8a8a")),
        ("LINEBEFORE", (1,1), (1,-1), 1.2, colors.black),
        ("FONT", (0,1), (0,-1), FB, 9),
        ("ALIGN", (0,0), (-1,-1), "CENTER"), ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("FONT", (1,0), (-1,0), F, 6), ("TEXTCOLOR", (1,0), (-1,0), colors.HexColor("#9a9a9a")),
        ("TOPPADDING", (0,0), (-1,-1), 0), ("BOTTOMPADDING", (0,0), (-1,-1), 0),
        ("LEFTPADDING", (0,0), (-1,-1), 1), ("RIGHTPADDING", (0,0), (-1,-1), 1),
    ]))
    return t

# ---------- per-song fiche ----------
def song_flow(s):
    fl = []
    left = f"{s['num']} — {san(s['title'])}"
    bits = [b for b in [fget(s,"Tonalité"), fget(s,"Tempo"),
                        (lambda x: x if x and x != "N/A" else None)(fget(s,"Mesure")),
                        fget(s,"Feel")] if b]
    right = san(" · ".join(bits))
    if s["group"]:
        right += "  ·  " + san(s["group"])
    hdr = Table([[Paragraph(left, hl_s), Paragraph(right, hr_s)]], colWidths=[95*mm, 91*mm])
    hdr.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), colors.HexColor("#E8E8E8" if BW else "#E7EBF3")),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING", (0,0), (0,0), 5), ("RIGHTPADDING", (-1,-1), (-1,-1), 5),
        ("TOPPADDING", (0,0), (-1,-1), 3.5), ("BOTTOMPADDING", (0,0), (-1,-1), 3.5),
        ("LINEBELOW", (0,0), (-1,-1), 1.2, colors.HexColor("#1b2540")),
    ]))
    fl.append(hdr)
    fl.append(Spacer(1, 1.5*mm))

    st = fget(s, "Structure")
    if st:
        if VISUAL:
            fl.append(Paragraph("Structure", sub_s))
            segs = [(chip_label(p), classify(p)) for p in split_structure(st)]
            segs = [(l, c) for l, c in segs if l]
            if segs:
                fl.append(Spacer(1, 0.8*mm))
                fl.append(SectionMap(segs, USABLE))
            fl.append(Spacer(1, 1.3*mm))
            fl.append(Paragraph("<font color='#777777'>" + san(st) + "</font>", struct_small))
        else:
            fl.append(Paragraph("<b>Structure</b>&nbsp;&nbsp;" + san(st), body_s))
        fl.append(Spacer(1, 1*mm))

    if s["chords"]:
        fl.append(Paragraph("Accords", sub_s))
        rows = []
        for lab, val in s["chords"]:
            if VISUAL and BW:
                f0, _b0 = cat_fb(classify(lab) if lab else "section")
                labp = Paragraph(f'<font color="{text_on(f0)}">{san(lab)}</font>', chlab_s)
            else:
                labp = Paragraph(san(lab), chlab_s)
            rows.append([labp, Paragraph(san(val), chval_s)])
        pad = 1.3 + max(0.0, (CHORD_PT - 8.4)) * 0.22
        ct = Table(rows, colWidths=[40*mm, 146*mm])
        base = [
            ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
            ("LINEBELOW", (0,0), (-1,-2), 0.25, colors.HexColor("#dddddd")),
            ("TOPPADDING", (0,0), (-1,-1), pad), ("BOTTOMPADDING", (0,0), (-1,-1), pad),
            ("LEFTPADDING", (0,0), (0,-1), 3.5 if VISUAL else 0), ("LEFTPADDING", (1,0), (1,-1), 4),
            ("RIGHTPADDING", (0,0), (-1,-1), 2),
        ]
        if VISUAL:  # tint each row-label cell to match its roadmap chip
            for i, (lab, _v) in enumerate(s["chords"]):
                fill, border = cat_fb(classify(lab) if lab else "section")
                base.append(("BACKGROUND", (0, i), (0, i), colors.HexColor(fill)))
                base.append(("LINEBEFORE", (0, i), (0, i), 2.4, colors.HexColor(border)))
        ct.setStyle(TableStyle(base))
        fl.append(ct)

    for nm in ["Riffs", "Breaks", "Notes"]:
        v = fget(s, nm)
        if v:
            col = "#9a9a9a" if v.strip() == "N/A" else "#000000"
            fl.append(Paragraph(f"<b>{nm}</b> : <font color='{col}'>{san(v)}</font>", body_s))

    for cap, large in s["grids"]:
        fl.append(Spacer(1, 1.6*mm))
        events = TABS.get((s["num"], cap))
        if events:                              # real tab from photo
            head = "<b>Tab</b> — " + san(cap)
            note = NOTES.get((s["num"], cap), "")
            if note:
                head += "  <font size=7 color='#9a9a9a'>(" + san(note) + ")</font>"
            fl.append(Paragraph(head, cap_s))
            fl.append(Spacer(1, 0.8*mm))
            for j, chunk in enumerate(tab_chunks(events)):
                if j:
                    fl.append(Spacer(1, 1.2*mm))
                fl.append(Preformatted(chunk, mono_s))
        else:                                    # blank grid to fill by hand
            fl.append(Paragraph("<b>Tab</b> — " + san(cap)
                                + "  <font size=7 color='#9a9a9a'>(6 cordes × 8 cases — à remplir)</font>", cap_s))
            fl.append(Spacer(1, 0.6*mm))
            fl.append(one_grid())
            if large:
                fl.append(Spacer(1, 1.0*mm))
                fl.append(one_grid())

    fl.append(Spacer(1, 4.5*mm))
    return KeepTogether(fl)

# ---------- cover ----------
def cover():
    fl = [Spacer(1, 4*mm),
          Paragraph("DEMO BAND", title_s),
          Paragraph("Préparation guitare — fiches de jeu", subt_s),
          Spacer(1, 2.5*mm),
          Paragraph(san("Notation : accords EN · texte FR · bémols uniquement "
                        "(Ab Bb Db Eb Gb)"), note_s)]
    if last_update:
        fl.append(Paragraph("Dernière mise à jour : " + san(last_update), note_s))
    fl.append(Paragraph(f"{len(songs)} chansons", note_s))
    fl.append(Paragraph("Généré le " + GEN_DATE + " · version tabs", note_s))
    fl.append(Spacer(1, 4.5*mm))

    head = [Paragraph("<b>#</b>", cth_s), Paragraph("<b>Titre</b>", cth_s),
            Paragraph("<b>Tonalité</b>", cth_s), Paragraph("<b>Tempo</b>", cth_s),
            Paragraph("<b>Tabs</b>", cth_s), Paragraph("<b>Rev.</b>", cth_s)]
    rows = [head]
    cmds = [("BACKGROUND", (0,0), (-1,0), colors.HexColor("#1b2540")),
            ("TEXTCOLOR", (0,0), (-1,0), colors.white),
            ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
            ("TOPPADDING", (0,0), (-1,-1), 3), ("BOTTOMPADDING", (0,0), (-1,-1), 3),
            ("ALIGN", (0,0), (0,-1), "CENTER"), ("ALIGN", (2,0), (-1,-1), "CENTER"),
            ("GRID", (0,0), (-1,-1), 0.3, colors.HexColor("#cccccc")),
            ("FONT", (0,1), (0,-1), FB, 8.8)]
    # white header text
    for c in range(6):
        head[c].style = ParagraphStyle("h%d"%c, parent=cth_s, textColor=colors.white)
    ri, curg = 1, None
    for s in songs:
        if s["group"] != curg:
            curg = s["group"]
            rows.append([Paragraph(san(curg), cgr_s), "", "", "", "", ""])
            cmds += [("SPAN", (0,ri), (-1,ri)),
                     ("BACKGROUND", (0,ri), (-1,ri), colors.HexColor("#EEF1F7")),
                     ("ALIGN", (0,ri), (0,ri), "LEFT")]
            ri += 1
        n = len(s["grids"])
        rows.append([s["num"], Paragraph(san(s["title"]), cbd_s),
                     san(fget(s,"Tonalité") or "—"),
                     san(fget(s,"Tempo") or "—"),
                     (str(n) if n else "—"), ""])
        ri += 1
    t = Table(rows, colWidths=[10*mm, 96*mm, 24*mm, 26*mm, 14*mm, 16*mm], repeatRows=1)
    t.setStyle(TableStyle(cmds))
    fl.append(t)

    fl.append(Spacer(1, 5*mm))
    fl.append(Paragraph("Mode d'emploi", sub_s))
    legend = ("Chaque <b>[TAB PLACEHOLDER]</b> du fichier source devient une grille de tablature "
              "vierge <b>6 cordes × 8 cases</b> (cordes de haut en bas : e B G D A E ; "
              "chiffres 1–8 = positions / temps) — à compléter à la main. "
              "La colonne <b>Tabs</b> indique le nombre de grilles par chanson ; "
              "cochez <b>Rev.</b> une fois la chanson révisée. "
              "Abréviations : PM = palm mute · disto = distorsion · fonda = fondamentales · "
              "trp = trompettes · contretemps = offbeat · ×∥ (→ ||) = boucle/répétition.")
    fl.append(Paragraph(legend, note_s))
    if VISUAL:
        fl.append(Spacer(1, 4.5*mm))
        fl.append(Paragraph("Carte d'arrangement — code " + ("gris (impression N&B)" if BW else "couleur")
                            + " des sections", sub_s))
        fl.append(Paragraph("Chaque chanson affiche sa structure en pastilles "
                            + ("(nuances de gris)" if BW else "colorées")
                            + " (à lire de gauche à droite) ; le détail exact reste en texte sous la carte.", note_s))
        fl.append(Spacer(1, 1.5*mm))
        order = ["intro","verse","chorus","bridge","break","solo","brass","feel","riff","ending","section"]
        fl.append(SectionMap([(CAT_LABEL[c], c) for c in order], USABLE))
    return fl

# ---------- footer ----------
def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont(F, 7); canvas.setFillColor(colors.HexColor("#9a9a9a"))
    canvas.drawString(12*mm, 7*mm, "Demo Band — guitar sheets")
    canvas.drawRightString(198*mm, 7*mm, "p. %d" % doc.page)
    canvas.restoreState()

# ---------- build ----------
doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=12*mm, rightMargin=12*mm,
                        topMargin=12*mm, bottomMargin=12*mm,
                        title="Demo Band — guitar sheets",
                        author="Demo Band",
                        subject=("Fiches de jeu guitare (structures, accords, tablatures) — "
                                 "%d morceaux — généré le %s" % (len(songs), GEN_DATE)),
                        creator="build_pdf.py (reportlab)",
                        keywords="guitar, tabs, chords, structure, setlist, demo")
story = cover() + [PageBreak()] + [song_flow(s) for s in songs]
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("OK ->", OUT, "| songs:", len(songs),
      "| grids:", sum(len(s["grids"]) for s in songs))
for s in songs:
    if s["grids"]:
        print("  ", s["num"], s["title"], "->", [c for c, _ in s["grids"]])
