"""Scaffold only: the rubric itself (grader/rubric.py) is user-authored.

Once fixtures exist under grader/fixtures/{perfect,slightly_off,badly_wrong}/
and grader/rubric.py implements `score()`, remove the skip and this should
pass: perfect > slightly_off > badly_wrong.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from grader.rubric import score

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def _scores_in(bucket: str) -> list[float]:
    paths = sorted((FIXTURES / bucket).glob("*.json"))
    return [score(json.loads(p.read_text()))["score"] for p in paths]


@pytest.mark.skip(reason="grader/rubric.py is not implemented yet (user-authored)")
def test_perfect_beats_slightly_off_beats_badly_wrong():
    perfect = _scores_in("perfect")
    slightly_off = _scores_in("slightly_off")
    badly_wrong = _scores_in("badly_wrong")
    assert perfect and slightly_off and badly_wrong, "add fixture JSON files first"
    assert min(perfect) > max(slightly_off)
    assert min(slightly_off) > max(badly_wrong)
