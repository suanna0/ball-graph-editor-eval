# Ball Bounce Eval. One command each to build, run a batch, grade a
# record, and build the aggregate report / gallery.

export PATH := $(HOME)/.docker/bin:$(PATH)

LIMIT ?=

.PHONY: help build run-batch grade aggregate gallery test typecheck

help:
	@echo "Targets:"
	@echo "  make build                 Install Python/Node deps, Playwright's browser, pull the worker image."
	@echo "  make run-batch [LIMIT=N]   Run the grid in runner.yaml (optionally capped to the first N cells)."
	@echo "  make dry-run               Print the expanded grid without running anything."
	@echo "  make grade RUN=<run-dir>   Grade one rollout (extract + score). Add STUB=1 to use a stub rubric."
	@echo "  make aggregate             Build the aggregate report over runs/."
	@echo "  make gallery               Build runs/gallery.html."
	@echo "  make test                  Run the extractor (vitest) and rubric (pytest) test suites."
	@echo "  make typecheck             Typecheck the TypeScript extractor."

build:
	python3 -m pip install -r requirements.txt
	npm install
	npx playwright install chromium
	PATH="$$HOME/.docker/bin:$$PATH" docker pull node:20-bookworm-slim

run-batch:
	python3 -m runtime.cli run-batch $(if $(LIMIT),--limit $(LIMIT))

dry-run:
	python3 -m runtime.cli run-batch --dry-run

grade:
	@test -n "$(RUN)" || (echo "usage: make grade RUN=runs/<rollout-dir>" >&2; exit 2)
	python3 -m grader.grade $(RUN) $(if $(STUB),--stub-rubric)

aggregate:
	python3 -m analysis.aggregate

gallery:
	python3 -m analysis.gallery

test:
	npx vitest run
	python3 -m pytest grader/tests -q

typecheck:
	npx tsc --noEmit
