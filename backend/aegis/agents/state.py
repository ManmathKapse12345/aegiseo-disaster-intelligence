"""Explicit agent state: goal, plan, semantic facts, evidence, decisions, flags."""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from datetime import date
from enum import StrEnum
from typing import Any

from aegis.geo.aoi import AOI


class Phase(StrEnum):
    OBSERVE = "observe"
    PERCEIVE = "perceive"
    STATE = "semantic_state"
    MEMORY = "memory"
    PLAN = "plan"
    ACT = "act"
    GUARDRAIL = "guardrail"
    OUTCOME = "outcome"
    FEEDBACK = "feedback"


@dataclass
class Goal:
    objective: str
    hazard: str
    aoi: AOI
    event_date: date
    pre_window: tuple[date, date]
    post_window: tuple[date, date]
    mode: str = "real"
    success_criteria: list[str] = field(default_factory=lambda: [
        "hazard extent mapped from at least one post-event sensor",
        "every published number traceable to recorded evidence",
        "uncertain or high-impact findings routed to a human analyst",
    ])
    autonomy: str = "advisory"  # the agent drafts; humans approve anything outward-facing

    def describe(self) -> dict[str, Any]:
        return {
            "objective": self.objective, "hazard": self.hazard, "aoi_bbox": self.aoi.bbox,
            "aoi_area_km2": round(self.aoi.area_km2, 2), "event_date": self.event_date.isoformat(),
            "pre_window": [d.isoformat() for d in self.pre_window], "post_window": [d.isoformat() for d in self.post_window],
            "mode": self.mode, "success_criteria": self.success_criteria, "autonomy": self.autonomy,
        }


@dataclass
class Fact:
    key: str
    value: Any
    unit: str | None
    source: str          # evidence id
    description: str
    confidence: str | None = None


@dataclass
class Decision:
    agent: str
    question: str
    chosen: str
    rationale: str
    alternatives: list[str] = field(default_factory=list)
    rule: str | None = None


@dataclass
class PlanStep:
    id: str
    agent: str
    action: str
    purpose: str
    status: str = "pending"  # pending | running | done | failed | skipped
    note: str | None = None


@dataclass
class AgentState:
    analysis_id: str
    goal: Goal
    plan: list[PlanStep] = field(default_factory=list)
    facts: dict[str, Fact] = field(default_factory=dict)
    evidence: dict[str, dict[str, Any]] = field(default_factory=dict)
    decisions: list[Decision] = field(default_factory=list)
    flags: set[str] = field(default_factory=set)
    warnings: list[str] = field(default_factory=list)
    escalations: list[dict[str, Any]] = field(default_factory=list)
    memory: dict[str, Any] = field(default_factory=dict)
    started: float = field(default_factory=time.time)

    def add_fact(self, key: str, value: Any, unit: str | None, source: str, description: str, confidence: str | None = None) -> None:
        self.facts[key] = Fact(key, value, unit, source, description, confidence)

    def add_evidence(self, eid: str, kind: str, description: str, **ref: Any) -> str:
        self.evidence[eid] = {"id": eid, "kind": kind, "description": description, **ref}
        return eid

    def decide(self, agent: str, question: str, chosen: str, rationale: str, alternatives: list[str] | None = None,
               rule: str | None = None) -> Decision:
        d = Decision(agent, question, chosen, rationale, alternatives or [], rule)
        self.decisions.append(d)
        return d

    def step(self, sid: str) -> PlanStep | None:
        return next((s for s in self.plan if s.id == sid), None)

    def set_step(self, sid: str, status: str, note: str | None = None) -> None:
        s = self.step(sid)
        if s:
            s.status = status
            if note:
                s.note = note

    def snapshot(self) -> dict[str, Any]:
        return {
            "goal": self.goal.describe(),
            "plan": [asdict(s) for s in self.plan],
            "facts": {k: asdict(v) for k, v in self.facts.items()},
            "evidence": self.evidence,
            "decisions": [asdict(d) for d in self.decisions],
            "flags": sorted(self.flags),
            "warnings": self.warnings,
            "escalations": self.escalations,
            "memory": self.memory,
            "elapsed_s": round(time.time() - self.started, 2),
        }
