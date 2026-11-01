import time

import pytest
from fastapi.testclient import TestClient

from aegis.config import reset_settings_cache
from aegis.main import create_app


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as c:
        yield c


def wait(client, aid, timeout=180):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = client.get(f"/api/analyses/{aid}/status").json()
        if st["status"] not in ("queued", "running"):
            return st
        time.sleep(0.5)
    raise AssertionError("analysis did not finish")


@pytest.fixture(scope="module")
def done(client):
    r = client.post("/api/analyses", json={"name": "API flood", "hazard": "flood", "mode": "synthetic", "event_date": "2024-08-20",
                                           "scenario_id": "synthetic-flood"})
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    st = wait(client, aid)
    assert st["status"] in ("completed", "completed_with_warnings"), st
    return aid


def test_health_ready_metrics(client):
    assert client.get("/api/health").json()["status"] == "ok"
    ready = client.get("/api/health/ready").json()
    assert ready["checks"]["database"]["status"] == "ok"
    assert "aegis_api_requests_total" in client.get("/metrics").text
    assert client.get("/api/health").headers["x-content-type-options"] == "nosniff"


def test_analysis_lifecycle_and_results(client, done):
    d = client.get(f"/api/analyses/{done}").json()
    assert d["mode"] == "synthetic" and d["summary"]["affected_area_km2"] > 0
    assert d["created_at"].endswith("+00:00")  # explicit UTC, so browsers do not read it as local time
    assert {r["kind"] for r in d["reports"]} == {"pdf", "csv", "geojson"}
    assert client.get(f"/api/analyses/{done}/detections").json()["features"]
    cells = client.get(f"/api/analyses/{done}/priorities").json()["features"]
    assert cells and cells[0]["properties"]["rank"] == 1
    fac = client.get(f"/api/analyses/{done}/facilities", params={"status": "inside"}).json()["features"]
    assert all(f["properties"]["status"] == "inside" for f in fac)
    tr = client.get(f"/api/analyses/{done}/trace").json()
    assert tr["steps"] and tr["tool_calls"] and tr["guardrails"] and tr["plan"]
    layers = client.get(f"/api/analyses/{done}/layers").json()
    png = client.get(layers[0]["url"])
    assert png.status_code == 200 and png.headers["content-type"] == "image/png"
    pdf = client.get(f"/api/analyses/{done}/reports/pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    csv = client.get(f"/api/analyses/{done}/reports/csv").text
    assert csv.startswith("rank,cell_id,category")
    gj = client.get(f"/api/analyses/{done}/reports/geojson").json()
    assert gj["type"] == "FeatureCollection" and gj["aegis"]["synthetic"] is True
    assert client.get(f"/api/analyses/{done}/exports/products.tif").status_code == 200
    lst = client.get("/api/analyses", params={"mode": "synthetic"}).json()
    assert lst["total"] >= 1 and all(a["mode"] == "synthetic" for a in lst["items"])


def test_human_review_flow(client, done):
    alerts = client.get("/api/alerts", params={"analysis_id": done}).json()["items"]
    assert len(alerts) >= 2
    a1 = client.post(f"/api/alerts/{alerts[0]['id']}/decision", json={"decision": "approve", "note": "ok"}).json()
    assert a1["status"] == "approved" and a1["delivery"]["delivered"] is False  # synthetic: never published
    a2 = client.post(f"/api/alerts/{alerts[1]['id']}/decision", json={"decision": "reject", "note": "fp"}).json()
    assert a2["status"] == "rejected"
    assert client.post(f"/api/alerts/{alerts[1]['id']}/decision", json={"decision": "approve"}).status_code == 409
    assert client.post("/api/alerts/nope/decision", json={"decision": "approve"}).status_code == 404
    cell = client.get(f"/api/analyses/{done}/priorities").json()["features"][0]["id"]
    ov = client.patch(f"/api/analyses/{done}/priorities/{cell}", json={"category": "Low", "reason": "field report: dry"}).json()
    assert ov["category"] == "Low" and ov["overridden_by"] == "local-analyst"
    assert client.patch(f"/api/analyses/{done}/priorities/{cell}", json={"category": "Low", "reason": "x"}).status_code == 422
    dash = client.get("/api/dashboard").json()
    assert dash["agent_metrics"]["priority_override_rate"] > 0 and dash["agent_metrics"]["alert_rejection_rate"] > 0


def test_review_task_decisions(client):
    r = client.post("/api/analyses", json={"name": "API landslide", "hazard": "landslide", "mode": "synthetic", "event_date": "2024-08-20",
                                           "scenario_id": "synthetic-landslide"})
    aid = r.json()["id"]
    assert wait(client, aid)["status"] == "needs_review"
    tasks = [t for t in client.get("/api/reviews").json()["items"] if t["analysis_id"] == aid]
    assert tasks
    for t in tasks:
        decision = "false_positive" if t is tasks[0] else "confirm"
        out = client.post(f"/api/reviews/{t['id']}/decision", json={"decision": decision, "comment": "checked VHR"}).json()
        assert out["decision"] == decision
    # a false positive without a specific cell rejects the analysis' pending alerts
    statuses = {a["status"] for a in client.get("/api/alerts", params={"analysis_id": aid}).json()["items"]}
    assert statuses == {"rejected"}
    assert client.get(f"/api/analyses/{aid}").json()["status"] == "completed_with_warnings"
    assert client.post(f"/api/reviews/{tasks[0]['id']}/decision", json={"decision": "confirm"}).status_code == 409


def test_input_validation_and_safety(client):
    assert client.post("/api/analyses", json={"name": "x", "hazard": "tsunami", "event_date": "2024-01-01"}).status_code == 422
    assert client.post("/api/analyses", json={"name": "Big", "hazard": "flood", "bbox": [0, 0, 5, 5], "event_date": "2024-01-01"}).status_code == 400
    assert client.post("/api/analyses", json={"name": "Future", "hazard": "flood", "bbox": [0, 0, 0.1, 0.1], "event_date": "2999-01-01"}).status_code == 400
    assert client.post("/api/analyses", json={"name": "No AOI", "hazard": "flood", "event_date": "2024-01-01"}).status_code == 422
    assert client.post("/api/analyses", json={"name": "Inject", "hazard": "flood", "mode": "real", "bbox": [0, 0, 0.1, 0.1],
                                              "event_date": "2024-01-01", "fail_tools": ["x"]}).status_code == 422
    assert client.post("/api/analyses", json={"name": "<script>", "hazard": "flood", "mode": "synthetic", "event_date": "2024-01-01"}).status_code == 422
    assert client.post("/api/analyses", json={"name": "Extra", "hazard": "flood", "mode": "synthetic", "event_date": "2024-01-01", "evil": 1}).status_code == 422
    assert client.get("/api/analyses/not-a-real-id").status_code == 400
    assert client.get("/api/analyses/" + "0" * 32).status_code == 404
    assert client.get("/api/analyses/" + "0" * 32 + "/layers/..%2F..%2Fsecret.png").status_code in (400, 404)
    err = client.get("/api/analyses/not-a-real-id").json()
    assert set(err["error"]) >= {"code", "message", "request_id"}


def test_knowledge_and_scenarios(client):
    hits = client.get("/api/knowledge/search", params={"q": "flooded built-up double bounce"}).json()
    assert hits and hits[0]["ref"].startswith("sar-flood-mapping")
    assert any(s["id"] == "pakistan-sindh-2022" for s in client.get("/api/scenarios").json())


def test_delete_requires_admin_and_finished(client, done):
    r = client.post("/api/analyses", json={"name": "To delete", "hazard": "wildfire", "mode": "synthetic", "event_date": "2024-08-20"})
    aid = r.json()["id"]
    wait(client, aid)
    assert client.delete(f"/api/analyses/{aid}").status_code == 204
    assert client.get(f"/api/analyses/{aid}").status_code == 404


def test_authentication_and_roles(monkeypatch):
    monkeypatch.setenv("AEGIS_AUTH_ENABLED", "true")
    monkeypatch.setenv("AEGIS_API_TOKENS", "tok-view=vera:viewer;tok-ana=ana:analyst")
    reset_settings_cache()
    try:
        with TestClient(create_app()) as c:
            assert c.get("/api/me").status_code == 401
            assert c.get("/api/me", headers={"Authorization": "Bearer wrong"}).status_code == 401
            assert c.get("/api/me", headers={"Authorization": "Bearer tok-view"}).json()["role"] == "viewer"
            body = {"name": "Auth test", "hazard": "flood", "mode": "synthetic", "event_date": "2024-08-20"}
            assert c.post("/api/analyses", json=body, headers={"Authorization": "Bearer tok-view"}).status_code == 403
            r = c.post("/api/analyses", json=body, headers={"Authorization": "Bearer tok-ana"})
            assert r.status_code == 201 and r.json()["created_by"] == "ana"
            aid = r.json()["id"]
            for _ in range(240):  # let the job finish before the app shuts down
                if c.get(f"/api/analyses/{aid}/status", headers={"Authorization": "Bearer tok-view"}).json()["status"] not in ("queued", "running"):
                    break
                time.sleep(0.5)
            assert c.delete(f"/api/analyses/{aid}", headers={"Authorization": "Bearer tok-ana"}).status_code == 403
    finally:
        monkeypatch.delenv("AEGIS_AUTH_ENABLED")
        monkeypatch.delenv("AEGIS_API_TOKENS")
        reset_settings_cache()


def test_rate_limiting(monkeypatch):
    monkeypatch.setenv("AEGIS_RATE_LIMIT_PER_MINUTE", "3")
    reset_settings_cache()
    try:
        with TestClient(create_app()) as c:
            codes = [c.post("/api/catalog/preview", json={"bbox": [0, 0, 0.1, 0.1], "event_date": "2024-01-01"}).status_code for _ in range(5)]
            assert 429 in codes and codes.index(429) == 3
    finally:
        monkeypatch.delenv("AEGIS_RATE_LIMIT_PER_MINUTE")
        reset_settings_cache()


def test_framing_policy(client, monkeypatch):
    page = client.get("/metrics")  # any non-API route carries the page policy
    assert page.headers["x-frame-options"] == "DENY" and "frame-ancestors 'none'" in page.headers["content-security-policy"]
    monkeypatch.setenv("AEGIS_FRAME_ANCESTORS", "https://huggingface.co")
    reset_settings_cache()
    try:
        with TestClient(create_app()) as c:
            r = c.get("/metrics")
            assert "x-frame-options" not in r.headers
            assert r.headers["content-security-policy"].endswith("frame-ancestors https://huggingface.co")
    finally:
        monkeypatch.delenv("AEGIS_FRAME_ANCESTORS")
        reset_settings_cache()
