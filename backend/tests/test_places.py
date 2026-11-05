"""Place-name search: parsing, local coordinate handling, Nominatim usage-policy throttling, API errors."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from aegis.config import Settings
from aegis.net.http import reset_breakers
from aegis.sources.places import PlaceSearch, PlaceSearchBusyError, normalise_query, parse_coordinates, parse_results

SAMPLE = [
    {"place_id": 1, "lat": "26.7303", "lon": "67.7764", "name": "Dadu", "display_name": "Dadu, Dadu District, Sindh, Pakistan",
     "boundingbox": ["26.5303", "26.9303", "67.5764", "67.9764"], "addresstype": "city"},
    {"place_id": 2, "lat": "not-a-number", "lon": "1", "display_name": "broken"},
    {"place_id": 3, "lat": "44.42", "lon": "11.86", "display_name": "Lugo, Ravenna, Emilia-Romagna, Italy", "type": "town"},
]


def online(tmp_path) -> Settings:
    return Settings(data_dir=tmp_path, offline=False, http_retries=0)


def test_parse_results_keeps_good_rows_and_converts_bbox():
    places = parse_results(SAMPLE)
    assert [p.name for p in places] == ["Dadu", "Lugo"]
    dadu = places[0]
    assert dadu.context == "Dadu District, Sindh, Pakistan"
    assert dadu.bbox == (67.5764, 26.5303, 67.9764, 26.9303)  # min_lon, min_lat, max_lon, max_lat
    assert places[1].bbox is None and places[1].kind == "town"
    assert parse_results({"error": "x"}) == []


def test_coordinates_are_answered_locally():
    p = parse_coordinates(" 26.7, 67.8 ")
    assert p is not None and (p.lat, p.lon) == (26.7, 67.8) and p.kind == "coordinates"
    assert parse_coordinates("95, 10") is None  # latitude out of range
    assert parse_coordinates("Dadu") is None
    assert normalise_query("  Dadu    district ") == "Dadu district"


def test_search_uses_cache_and_spaces_requests(tmp_path):
    reset_breakers()
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json=SAMPLE[:1])

    clock = {"t": 100.0}
    sleeps: list[float] = []

    def sleep(s: float) -> None:
        sleeps.append(s)
        clock["t"] += s

    ps = PlaceSearch(online(tmp_path), transport=httpx.MockTransport(handler), clock=lambda: clock["t"], sleep=sleep)
    assert ps.search("Dadu")[0].name == "Dadu"
    assert ps.search("Dadu")[0].name == "Dadu"  # second identical search served from cache
    assert len(calls) == 1
    assert calls[0].url.params["format"] == "jsonv2"
    assert "AegisEO" in calls[0].headers["user-agent"]  # identifying User-Agent (usage policy)
    ps.search("Lugo")  # a new query must wait for the 1 s slot
    assert len(calls) == 2 and sleeps and abs(sum(sleeps) - 1.0) < 1e-6
    assert ps.search("2, 3")[0].kind == "coordinates" and len(calls) == 2  # no network for coordinates
    assert ps.search("x") == []


def test_queue_limit_refuses_instead_of_piling_up(tmp_path):
    ps = PlaceSearch(online(tmp_path), transport=httpx.MockTransport(lambda r: httpx.Response(200, json=[])),
                     clock=lambda: 0.0, sleep=lambda s: None)
    with pytest.raises(PlaceSearchBusyError):
        for _ in range(10):  # clock frozen: each call books the next 1 s slot
            ps._wait_for_slot()


def test_api_reports_plain_errors_offline():
    from aegis.main import app

    with TestClient(app) as c:
        r = c.get("/api/places", params={"q": "Dadu"})  # tests run offline: no cache, so the source is unavailable
        assert r.status_code == 503
        assert "not available right now" in r.json()["error"]["message"]
        ok = c.get("/api/places", params={"q": "26.7, 67.8"})
        assert ok.status_code == 200 and ok.json()["results"][0]["kind"] == "coordinates"
        assert c.get("/api/places", params={"q": "x"}).status_code == 422
