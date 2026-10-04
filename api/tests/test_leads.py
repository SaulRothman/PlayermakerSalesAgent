from api.catalog import CatalogStore
from api.leads import load_leads


def test_capture_lead_honest_no_local(client, data_dir, monkeypatch):
    monkeypatch.delenv("DEVREV_PAT", raising=False)
    r = client.post(
        "/v1/leads",
        json={
            "session_id": "s-honest",
            "parent_name": "Alex Parent",
            "email": "Alex@Example.com",
            "outcome": "honest_no",
            "product_id": None,
            "why": "Under 8 is outside the stated range.",
            "signals": {"age": 7},
            "source": "help-me-decide",
        },
    )
    assert r.status_code == 201
    lead = r.json()["lead"]
    assert lead["email"] == "alex@example.com"
    assert lead["outcome"] == "honest_no"
    assert lead["pipeline"]["destination"] == "local"
    disk = load_leads(data_dir)
    assert len(disk["leads"]) == 1
    assert disk["leads"][0]["parent_name"] == "Alex Parent"


def test_capture_lead_match_and_list(client, monkeypatch):
    monkeypatch.delenv("DEVREV_PAT", raising=False)
    r = client.post(
        "/leads",
        json={
            "session_id": "s-match",
            "parent_name": "Sam",
            "email": "sam@example.com",
            "outcome": "match",
            "product_id": "playermaker-2.0",
            "why": "Core tracker",
            "signals": {"age": 12, "wants_man_city_content": False},
        },
    )
    assert r.status_code == 201
    listed = client.get("/v1/leads")
    assert listed.status_code == 200
    assert listed.json()["count"] >= 1
    assert any(item["email"] == "sam@example.com" for item in listed.json()["leads"])


def test_capture_lead_rejects_bad_email(client, monkeypatch):
    monkeypatch.delenv("DEVREV_PAT", raising=False)
    r = client.post(
        "/v1/leads",
        json={"session_id": "s-bad", "parent_name": "Pat", "email": "not-an-email", "outcome": "honest_no"},
    )
    assert r.status_code == 400


def test_capture_lead_devrev_success(client, monkeypatch):
    monkeypatch.setenv("DEVREV_PAT", "test-pat-not-real")
    monkeypatch.setenv("DEVREV_PART_ID", "PROD-1")

    def fake_push(lead):
        assert lead["email"] == "dev@example.com"
        assert lead["outcome"] == "lead"
        return {
            "destination": "devrev",
            "account_id": "acc-1",
            "contact_id": "don:revu/1",
            "contact_display_id": "REVU-1",
            "work_id": "don:work/1",
            "work_display_id": "TKT-1",
            "error": None,
        }

    monkeypatch.setattr("api.leads.push_to_devrev", fake_push)
    r = client.post(
        "/v1/leads",
        json={
            "session_id": "s-team",
            "parent_name": "Coach",
            "email": "dev@example.com",
            "outcome": "lead",
            "signals": {"buyer_type": "team_or_club"},
        },
    )
    assert r.status_code == 201
    pipe = r.json()["lead"]["pipeline"]
    assert pipe["destination"] == "devrev"
    assert pipe["contact_display_id"] == "REVU-1"
    assert pipe["work_display_id"] == "TKT-1"


def test_leads_require_key_when_set(data_dir, monkeypatch):
    monkeypatch.setenv("CATALOG_DATA_DIR", str(data_dir))
    monkeypatch.setenv("CATALOG_API_KEY", "test-key")
    monkeypatch.delenv("DEVREV_PAT", raising=False)
    import api.app as appmod
    from fastapi.testclient import TestClient

    appmod.store = CatalogStore(data_dir)
    c = TestClient(appmod.app)
    body = {
        "session_id": "s-key",
        "parent_name": "Key",
        "email": "key@example.com",
        "outcome": "honest_no",
    }
    assert c.post("/v1/leads", json=body).status_code == 401
    assert c.post("/v1/leads", json=body, headers={"X-API-Key": "test-key"}).status_code == 201
    monkeypatch.delenv("CATALOG_API_KEY", raising=False)
