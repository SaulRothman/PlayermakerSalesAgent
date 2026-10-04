from api.catalog import CatalogStore


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_list_products(client):
    r = client.get("/products")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 3
    ids = {p["product_id"] for p in body["products"]}
    assert ids == {"playermaker-2.0", "cityplay", "extra-straps"}
    assert body["products"][0]["variants"][0]["price"]


def test_get_product(client):
    r = client.get("/products/cityplay")
    assert r.status_code == 200
    assert r.json()["product"]["name"] == "CITYPLAY"


def test_fit_match_honest_no(client):
    r = client.post("/fit/match", json={"signals": {"age": 7}})
    assert r.status_code == 200
    assert r.json()["outcome"] == "honest_no"
    assert r.json()["best_fit_product_id"] is None


def test_fit_match_cityplay(client):
    r = client.post("/v1/fit/match", json={"signals": {"age": 13, "wants_man_city_content": True}})
    assert r.status_code == 200
    assert r.json()["best_fit_product_id"] == "cityplay"


def test_fit_explain(client):
    r = client.post(
        "/fit/explain",
        json={"product_id": "playermaker-2.0", "signals": {"age": 10, "wants_man_city_content": False}},
    )
    assert r.status_code == 200
    assert r.json()["fits"] is True


def test_fit_compare(client):
    r = client.post("/fit/compare", json={"product_ids": ["playermaker-2.0", "cityplay", "extra-straps"]})
    assert r.status_code == 200
    body = r.json()
    assert len(body["products"]) == 3
    assert any(t["topic"] == "exclusive_content" for t in body["topics"])


def test_objections_search(client):
    r = client.get("/objections", params={"q": "battery"})
    assert r.status_code == 200
    assert r.json()["count"] >= 1
    assert any("battery" in o["objection"].lower() for o in r.json()["objections"])


def test_gaps(client):
    r = client.get("/gaps", params={"severity": "conflict"})
    assert r.status_code == 200
    assert r.json()["count"] >= 1


def test_catalog_edit_roundtrip(client, data_dir):
    r = client.patch("/products/playermaker-2.0", json={"vendor": "Playermaker-edited"})
    assert r.status_code == 200
    assert r.json()["product"]["vendor"] == "Playermaker-edited"
    assert r.json()["product"]["product_id"] == "playermaker-2.0"
    disk = CatalogStore(data_dir).get_product("playermaker-2.0")
    assert disk["vendor"] == "Playermaker-edited"
    # restore field
    client.patch("/products/playermaker-2.0", json={"vendor": "Playermaker"})


def test_scan_reload_only(client):
    r = client.post("/scan/refresh", json={"reload_only": True})
    assert r.status_code == 200
    assert r.json()["status"] == "completed"
    assert r.json()["meta"]["counts"]["products"] == 3


def test_api_key_required_when_set(data_dir, monkeypatch):
    monkeypatch.setenv("CATALOG_DATA_DIR", str(data_dir))
    monkeypatch.setenv("CATALOG_API_KEY", "test-key")
    import api.app as appmod
    from fastapi.testclient import TestClient

    appmod.store = CatalogStore(data_dir)
    c = TestClient(appmod.app)
    assert c.get("/products").status_code == 401
    assert c.get("/products", headers={"X-API-Key": "test-key"}).status_code == 200
    monkeypatch.delenv("CATALOG_API_KEY", raising=False)
