# Makefile — legacy Python generator (reference), runs on the fictional sample.
# Usage:  make            -> both versions (colour + B&W)
#         make color      -> colour only
#         make bw         -> black & white only
#         make clean      -> remove the Python cache
# Option: make color PT=14   (chord size, default 12)

PY    ?= python3
GEN   := build_pdf.py
PT    ?= 12
COLOR := demo_sheets-color.pdf
BW    := demo_sheets-bw.pdf

.PHONY: all color bw clean help
.DEFAULT_GOAL := all

all: color bw            ## Both versions (colour + B&W)

color:                   ## Colour version only
	$(PY) $(GEN) $(PT) "$(COLOR)" map

bw:                      ## Black & white version (printers with no colour)
	$(PY) $(GEN) $(PT) "$(BW)" map bw

clean:                   ## Remove the Python cache (__pycache__)
	rm -rf __pycache__

help:                    ## List targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F'##' '{ split($$1,a,":"); printf "  make %-7s %s\n", a[1], $$2 }'
