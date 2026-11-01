"""Agent memory.

Semantic memory (RAG)   curated methodology / guidance notes (``aegis/knowledge/*.md``),
                        chunked by section and indexed with TF-IDF vectors (cosine
                        similarity). Retrieved passages are cited in alerts and reports as
                        ``[KB:<doc>#<section>]`` so every guidance statement is traceable.
Episodic memory         previous analyses of overlapping areas and the decisions human
                        reviewers made about them (rejections, overrides), retrieved from the
                        database so that past analyst feedback informs new runs.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sqlalchemy import select
from sqlalchemy.orm import Session

from aegis.db import Alert, Analysis, PriorityCell, ReviewTask

KNOWLEDGE_DIR = Path(__file__).resolve().parents[1] / "knowledge"


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


@dataclass(frozen=True)
class Passage:
    doc_id: str
    doc_title: str
    section: str
    text: str
    tags: tuple[str, ...]

    @property
    def ref(self) -> str:
        return f"{self.doc_id}#{slug(self.section)}"

    def as_dict(self, score: float | None = None) -> dict[str, Any]:
        d = {"ref": self.ref, "doc_id": self.doc_id, "doc_title": self.doc_title, "section": self.section,
             "text": self.text, "tags": list(self.tags)}
        if score is not None:
            d["score"] = round(float(score), 4)
        return d


def _parse(path: Path) -> list[Passage]:
    raw = path.read_text(encoding="utf-8")
    meta: dict[str, str] = {}
    body = raw
    if raw.startswith("---"):
        _, front, body = raw.split("---", 2)
        for line in front.strip().splitlines():
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip()
    doc_id = meta.get("id", path.stem)
    title = meta.get("title", path.stem)
    tags = tuple(t.strip() for t in meta.get("tags", "").split(",") if t.strip())
    passages = []
    for block in re.split(r"^## ", body, flags=re.M)[1:]:
        heading, _, text = block.partition("\n")
        text = " ".join(text.split())
        if text:
            passages.append(Passage(doc_id, title, heading.strip(), text, tags))
    return passages


class KnowledgeBase:
    def __init__(self, directory: Path = KNOWLEDGE_DIR):
        self.passages: list[Passage] = []
        for p in sorted(directory.glob("*.md")):
            self.passages.extend(_parse(p))
        if not self.passages:
            raise RuntimeError(f"knowledge base at {directory} is empty")
        self.vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), sublinear_tf=True, min_df=1)
        corpus = [f"{p.doc_title} {p.section} {p.section} {' '.join(p.tags)} {p.text}" for p in self.passages]
        self.matrix = self.vectorizer.fit_transform(corpus)

    def search(self, query: str, k: int = 4, tags: list[str] | None = None, min_score: float = 0.04) -> list[tuple[Passage, float]]:
        if not query.strip():
            return []
        q = self.vectorizer.transform([query])
        scores = (self.matrix @ q.T).toarray().ravel()
        if tags:
            boost = np.array([1.15 if set(tags) & set(p.tags) else 1.0 for p in self.passages])
            scores = scores * boost
        order = np.argsort(-scores)
        out = []
        for i in order[: max(k * 3, k)]:
            if scores[i] < min_score:
                break
            out.append((self.passages[i], float(scores[i])))
            if len(out) >= k:
                break
        return out

    def get(self, ref: str) -> Passage | None:
        return next((p for p in self.passages if p.ref == ref), None)


_KB: KnowledgeBase | None = None
_KB_LOCK = threading.Lock()


def get_knowledge_base() -> KnowledgeBase:
    global _KB
    with _KB_LOCK:
        if _KB is None:
            _KB = KnowledgeBase()
        return _KB


def similar_cases(session: Session, bbox: tuple[float, float, float, float], hazard: str, exclude_id: str | None = None,
                  margin_deg: float = 0.25, limit: int = 5) -> list[dict[str, Any]]:
    """Earlier analyses overlapping the AOI (expanded by ``margin_deg``) with reviewer feedback."""
    minx, miny, maxx, maxy = bbox
    q = (
        select(Analysis)
        .where(Analysis.hazard == hazard)
        .where(Analysis.max_lon >= minx - margin_deg, Analysis.min_lon <= maxx + margin_deg)
        .where(Analysis.max_lat >= miny - margin_deg, Analysis.min_lat <= maxy + margin_deg)
        .where(Analysis.status.in_(("completed", "completed_with_warnings", "needs_review")))
        .order_by(Analysis.created_at.desc())
        .limit(limit)
    )
    out = []
    for a in session.scalars(q):
        if a.id == exclude_id:
            continue
        reviews = session.scalars(select(ReviewTask).where(ReviewTask.analysis_id == a.id, ReviewTask.status == "resolved")).all()
        rejected_alerts = session.scalars(select(Alert).where(Alert.analysis_id == a.id, Alert.status == "rejected")).all()
        overrides = session.scalars(select(PriorityCell).where(PriorityCell.analysis_id == a.id,
                                                               PriorityCell.override_category.is_not(None))).all()
        out.append({
            "analysis_id": a.id,
            "name": a.name,
            "event_date": a.event_date.isoformat(),
            "mode": a.mode,
            "summary": {k: (a.summary or {}).get(k) for k in ("affected_area_km2", "population_exposed", "top_priority", "confidence")},
            "review_decisions": [{"kind": r.kind, "decision": r.decision, "comment": r.comment} for r in reviews],
            "rejected_alerts": [{"title": al.title, "note": al.decision_note} for al in rejected_alerts],
            "priority_overrides": [{"cell": c.cell_id, "from": c.category, "to": c.override_category, "reason": c.override_reason}
                                   for c in overrides],
        })
    return out
