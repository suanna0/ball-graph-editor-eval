# Ball Bounce Eval. One command each to build, run a batch, grade a
# record, and build the aggregate report / gallery.

export PATH := $(HOME)/.docker/bin:$(PATH)

LIMIT ?=
LABEL ?=

# `make viewer` renders the interactive viewer from any curves.json. It
# defaults to a real extracted sample so the view can be worked on without
# re-running a rollout. Output goes under runs/, which is gitignored.
CURVES ?= extractor/fixtures/sample-curves/css-bowling-ball.json
VIEWER_OUT ?= runs/viewer-sample.html

.PHONY: help build run-batch grade aggregate gallery viewer viewers test typecheck

help:
	@echo "Targets:"
	@echo "  make build                 Install Python/Node deps, Playwright's browser, pull the worker image."
	@echo "  make run-batch [LIMIT=N] [LABEL=name]   Run the grid in runner.yaml (optionally capped to the first N cells, batch dir named <timestamp>_<name>)."
	@echo "  make dry-run               Print the expanded grid without running anything."
	@echo "  make grade RUN=<run-dir>   Grade one rollout (extract + score). Add STUB=1 to use a stub rubric."
	@echo "  make aggregate             Build the aggregate report over runs/."
	@echo "  make gallery               Build runs/gallery.html."
	@echo "  make viewer [CURVES=<f>]   Render the interactive viewer from a curves.json (defaults to the sample fixture)."
	@echo "  make viewers               Render every run's curves.json into runs/viewers/<batch>/<cell>.html."
	@echo "  make test                  Run the extractor (vitest) and rubric (pytest) test suites."
	@echo "  make typecheck             Typecheck the TypeScript extractor."

build:
	python3 -m pip install -r requirements.txt
	npm install
	npx playwright install chromium
	PATH="$$HOME/.docker/bin:$$PATH" docker pull node:20-bookworm-slim

run-batch:
	python3 -m runtime.cli run-batch $(if $(LIMIT),--limit $(LIMIT)) $(if $(LABEL),--label $(LABEL))

dry-run:
	python3 -m runtime.cli run-batch --dry-run

grade:
	@test -n "$(RUN)" || (echo "usage: make grade RUN=runs/<rollout-dir>" >&2; exit 2)
	python3 -m grader.grade $(RUN) $(if $(STUB),--stub-rubric)

aggregate:
	python3 -m analysis.aggregate

gallery:
	python3 -m analysis.gallery

viewer:
	@mkdir -p $(dir $(VIEWER_OUT))
	npx tsx extractor/src/render-viewer.ts $(CURVES) $(VIEWER_OUT)
	@echo "wrote $(VIEWER_OUT)  (from $(CURVES))"

# Renders every rollout's curves.json into runs/viewers/<batch>/<cell>.html,
# mirroring runs/'s own <batch>/<cell> layout so each viewer's filename
# alone says which run it's from -- no separate index to keep in sync.
viewers:
	@for f in runs/*/*/extracted/curves.json; do \
		[ -e "$$f" ] || continue; \
		cell=$$(basename $$(dirname $$(dirname $$f))); \
		batch=$$(basename $$(dirname $$(dirname $$(dirname $$f)))); \
		out="runs/viewers/$$batch/$$cell.html"; \
		mkdir -p "runs/viewers/$$batch"; \
		npx tsx extractor/src/render-viewer.ts "$$f" "$$out"; \
		echo "wrote $$out"; \
	done

test:
	npx vitest run
	python3 -m pytest grader/tests -q

typecheck:
	npx tsc --noEmit
