import json
from datetime import UTC, datetime

import httpx
import pytest

from aegis.config import Settings
from aegis.geo.aoi import AOI
from aegis.net.http import ResilientHttpClient, SourceUnavailableError, get_breaker, redact_url, reset_breakers
from aegis.sources.imagery import s2_offset
from aegis.sources.osm import build_query, categorize, parse_elements
from aegis.sources.population import PopulationSource
from aegis.sources.stac import PlanetaryComputer, SceneItem


def online(tmp_path) -> Settings:
    return Settings(data_dir=tmp_path, offline=False, http_retries=2)


def client(tmp_path, handler, **kw) -> ResilientHttpClient:
    reset_breakers()
    return ResilientHttpClient("test_source", settings=online(tmp_path), transport=httpx.MockTransport(handler), backoff_base_s=0.001, **kw)


def test_retry_then_success(tmp_path):
    n = {"calls": 0}

    def h(req):
        n["calls"] += 1
        return httpx.Response(503) if n["calls"] < 3 else httpx.Response(200, json={"ok": True})

    res = client(tmp_path, h).get("https://example.org/a", use_cache=False)
    assert res.json() == {"ok": True} and res.attempts == 3 and n["calls"] == 3


def test_client_errors_are_not_retried(tmp_path):
    n = {"calls": 0}

    def h(req):
        n["calls"] += 1
        return httpx.Response(404, text="missing")

    with pytest.raises(SourceUnavailableError) as e:
        client(tmp_path, h).get("https://example.org/b", use_cache=False)
    assert e.value.status_code == 404 and n["calls"] == 1


def test_circuit_breaker_opens_and_stale_cache_is_served(tmp_path):
    state = {"up": True}

    def h(req):
        if state["up"]:
            return httpx.Response(200, json={"v": 1})
        raise httpx.ConnectError("down")

    c = client(tmp_path, h, cache_ttl_s=0.0001)
    assert c.get("https://example.org/c").json() == {"v": 1}
    state["up"] = False
    stale = c.get("https://example.org/c")
    assert stale.stale and stale.from_cache and stale.json() == {"v": 1}
    for _ in range(4):
        with pytest.raises(SourceUnavailableError):
            c.get("https://example.org/other", use_cache=False)
    assert get_breaker("test_source").state == "open"
    with pytest.raises(SourceUnavailableError, match="circuit open"):
        c.get("https://example.org/other2", use_cache=False)


def test_offline_mode_uses_only_cache(tmp_path):
    c = ResilientHttpClient("off", settings=Settings(data_dir=tmp_path, offline=True),
                            transport=httpx.MockTransport(lambda r: httpx.Response(200)))
    with pytest.raises(SourceUnavailableError, match="offline"):
        c.get("https://example.org/x")


def test_url_redaction():
    u = redact_url("https://acct.blob.core.windows.net/c/f.tif?st=1&se=2&sig=SECRET&sp=r&keep=yes")
    assert "SECRET" not in u and "keep=yes" in u
    assert "abc" not in redact_url("https://x/api?map_key=abc&day=1")


def test_osm_categorisation_and_parsing():
    assert categorize({"amenity": "hospital"}) == "hospital"
    assert categorize({"healthcare": "clinic"}) == "clinic"
    assert categorize({"amenity": "shelter"}) is None  # bus shelters are not emergency shelters
    assert categorize({"social_facility": "shelter"}) == "shelter"
    els = [
        {"type": "node", "id": 1, "lat": 1.0, "lon": 2.0, "tags": {"amenity": "school", "name": "A"}},
        {"type": "way", "id": 2, "center": {"lat": 1.1, "lon": 2.1}, "tags": {"amenity": "hospital"}},
        {"type": "way", "id": 3, "geometry": [{"lat": 0, "lon": 0}, {"lat": 0.1, "lon": 0.1}], "tags": {"highway": "primary"}},
        {"type": "node", "id": 1, "lat": 1.0, "lon": 2.0, "tags": {"amenity": "school"}},  # duplicate
        {"type": "node", "id": 9, "lat": 1.0, "lon": 2.0, "tags": {"shop": "bakery"}},
    ]
    feats = parse_elements(els)
    assert [f["category"] for f in feats] == ["school", "hospital", "road"]
    assert feats[2]["geometry"]["type"] == "LineString"
    q = build_query(1, 2, 3, 4)
    assert "(1.000000,2.000000,3.000000,4.000000)" in q and "out geom" in q


def test_worldpop_json_extraction_with_php_noise():
    noisy = "<br /><b>Deprecated</b>: Return type of Pimple {foo}<br />\n" + json.dumps(
        {"status": "finished", "error": False, "data": {"total_population": 1234.5}}) + "\n<br/>"
    assert PopulationSource._extract_json(noisy)["data"]["total_population"] == 1234.5
    with pytest.raises(ValueError):
        PopulationSource._extract_json("<html>nothing</html>")


def _item(i, dt, pb, tile="42RUQ", platform="sentinel-2b", cc=5.0, geom=None):
    return SceneItem(id=i, collection="sentinel-2-l2a", datetime=dt, bbox=[0, 0, 1, 1],
                     geometry=geom or {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]},
                     properties={"platform": platform, "s2:processing_baseline": pb, "s2:mgrs_tile": tile, "eo:cloud_cover": cc,
                                 "s2:generation_time": pb, "sat:relative_orbit": 134, "sat:orbit_state": "descending"},
                     assets={})


def test_s2_dedupe_grouping_and_offset():
    t = datetime(2022, 9, 18, 6, 6, tzinfo=UTC)
    items = [_item("orig", t, "04.00"), _item("reproc", t, "05.10"), _item("other-tile", t, "04.00", tile="42RUR")]
    kept = PlanetaryComputer.dedupe_s2(items)
    assert {i.id for i in kept} == {"reproc", "other-tile"}
    acqs = PlanetaryComputer.group_acquisitions("S2", kept, AOI.from_bbox(0.2, 0.2, 0.8, 0.8))
    assert len(acqs) == 1 and acqs[0].aoi_coverage == pytest.approx(1.0) and len(acqs[0].items) == 2
    assert s2_offset(_item("a", t, "05.10")) == -1000 and s2_offset(_item("b", t, "03.01")) == 0


@pytest.mark.network
def test_live_planetary_computer_search():
    pc = PlanetaryComputer(Settings(offline=False))
    aoi = AOI.from_bbox(67.70, 26.60, 67.80, 26.70)
    acqs = pc.find_acquisitions("S1", aoi, datetime(2022, 8, 20, tzinfo=UTC), datetime(2022, 9, 5, tzinfo=UTC))
    assert acqs and all(a.sensor == "S1" for a in acqs)
