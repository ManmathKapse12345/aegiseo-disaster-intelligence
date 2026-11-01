"""Scene-selection reasoning of the data-acquisition agent, against a mocked catalogue."""

from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import numpy as np

from aegis.agents.recorder import TraceRecorder
from aegis.agents.specialists import DataAcquisitionAgent
from aegis.agents.state import AgentState, Goal
from aegis.agents.tools import SideEffect, Tool, ToolExecutor
from aegis.analysis.bundle import ContextLayers, SensorObservation
from aegis.config import get_settings
from aegis.geo.aoi import AOI
from aegis.sources.stac import Acquisition

EVENT = date(2024, 8, 20)


def acq(sensor, day, orbit=78, cloud=None, key=None):
    dt = datetime.combine(day, datetime.min.time(), tzinfo=UTC) + timedelta(hours=6)
    return Acquisition(sensor=sensor, key=key or f"{sensor}-{day}-{orbit}", datetime=dt, items=[], aoi_coverage=1.0,
                       cloud_cover=cloud, relative_orbit=orbit, orbit_state="descending", platform="SENTINEL-1A")


def make_agent(catalog, cloud_valid, pre=(EVENT - timedelta(30), EVENT - timedelta(1)), post=(EVENT, EVENT + timedelta(10))):
    def search_imagery(sensor, aoi, start, end):
        return [a for a in catalog[sensor] if start <= a.datetime.date() <= end]

    def assess_cloud_cover(acquisition, grid, aoi_mask):
        return {"cloud_fraction": 1 - cloud_valid[acquisition.key], "valid_fraction": cloud_valid[acquisition.key]}

    def load(acquisition, grid, role, aoi_mask):
        z = np.zeros(grid.shape, np.float32)
        bands = {"vv_db": z - 10, "vh_db": z - 17} if acquisition.sensor == "S1" else {b: z + 0.1 for b in ("B02", "B03", "B04", "B08", "B11", "B12")}
        return SensorObservation(acquisition.sensor, role, acquisition.datetime, "c", [acquisition.key], bands, np.ones(grid.shape, bool),
                                 valid_fraction=1.0, meta={"relative_orbit": acquisition.relative_orbit})

    tools = [Tool("search_imagery", "", SideEffect.READ_ONLY, search_imagery), Tool("assess_cloud_cover", "", SideEffect.READ_ONLY, assess_cloud_cover),
             Tool("load_s1", "", SideEffect.READ_ONLY, load), Tool("load_s2", "", SideEffect.READ_ONLY, load),
             Tool("load_context_layers", "", SideEffect.READ_ONLY, lambda aoi, grid: ContextLayers(provenance={}))]
    rec = TraceRecorder(None, persist=False)
    aoi = AOI.from_bbox(0.0, 0.0, 0.03, 0.03)
    state = AgentState("t", Goal("test", "flood", aoi, EVENT, pre, post))
    orch = SimpleNamespace(state=state, tools=ToolExecutor(tools, rec), recorder=rec, services=SimpleNamespace(settings=get_settings()),
                           cfg=SimpleNamespace(resolution_m=20))
    return DataAcquisitionAgent(orch), state


def rules(state):
    return {d.rule: d for d in state.decisions}


def test_selection_rules_p1_p2_p4():
    s1_post = [acq("S1", EVENT + timedelta(2), 78), acq("S1", EVENT + timedelta(5), 151)]
    s1_pre = [acq("S1", EVENT - timedelta(10), 78), acq("S1", EVENT - timedelta(4), 151)]
    s2 = [acq("S2", EVENT + timedelta(1), cloud=1.0, key="s2-cloudy-tile-but-clear-aoi"), acq("S2", EVENT + timedelta(3), cloud=5.0, key="s2-post-b"),
          acq("S2", EVENT - timedelta(6), cloud=2.0, key="s2-pre")]
    valid = {"s2-cloudy-tile-but-clear-aoi": 0.15, "s2-post-b": 0.9, "s2-pre": 0.95}
    agent, state = make_agent({"S1": s1_post + s1_pre, "S2": s2}, valid)
    bundle = agent.run()
    r = rules(state)
    assert "P1" in r and r["P1"].chosen.startswith((EVENT + timedelta(2)).isoformat())  # earliest post SAR pass
    pre_s1 = bundle.get("S1", "pre")
    assert pre_s1.meta["relative_orbit"] == 78  # same orbit preferred over the closer orbit-151 pass
    assert bundle.get("S2", "post").item_ids == ["s2-post-b"]  # AOI-level cloud decides, not tile-level cloud
    assert all(k in bundle.observations for k in [("S1", "post"), ("S1", "pre"), ("S2", "post"), ("S2", "pre")])
    assert "s1_orbit_mismatch" not in state.flags


def test_window_extension_and_unusable_optical():
    s1_late = [acq("S1", EVENT + timedelta(14), 78)]  # outside the 10-day post window
    s2 = [acq("S2", EVENT + timedelta(2), cloud=80.0, key="all-cloud")]
    agent, state = make_agent({"S1": s1_late, "S2": s2}, {"all-cloud": 0.01}, post=(EVENT, EVENT + timedelta(10)))
    bundle = agent.run()
    r = rules(state)
    assert "P3" in r and bundle.has("S1", "post")  # extended the window and found the later pass
    assert "s2_post_unusable" in state.flags and not bundle.has("S2", "post")
    assert any(d.rule == "P2" and d.chosen == "none usable" for d in state.decisions)
    assert "s1_pre_missing" in state.flags


def test_orbit_mismatch_flagged():
    agent, state = make_agent({"S1": [acq("S1", EVENT + timedelta(2), 78), acq("S1", EVENT - timedelta(3), 151)], "S2": []}, {})
    agent.run()
    assert "s1_orbit_mismatch" in state.flags
