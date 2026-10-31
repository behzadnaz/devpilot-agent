from fastapi.testclient import TestClient
from environment.local_agent import create_local_agent


def test_local_agent_returns_environment_check_results():
    class FakeChecker:
        def check(self, requirements):
            return [
                {
                    "component": "backend",
                    "name": "python",
                    "requested_version": None,
                    "detected_version": "3.13.0",
                    "status": "installed",
                }
            ]

    client = TestClient(create_local_agent(checker=FakeChecker()))

    response = client.post(
        "/environment/check",
        json={"requirements": [{"component": "backend", "name": "python"}]},
    )

    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "installed"


def test_local_agent_rejects_missing_requirements():
    client = TestClient(create_local_agent())

    response = client.post("/environment/check", json={})

    assert response.status_code == 422


def test_local_agent_rejects_invalid_requirements():
    client = TestClient(create_local_agent())

    response = client.post(
        "/environment/check",
        json={"requirements": [{"name": ""}]},
    )

    assert response.status_code == 422


def test_local_agent_does_not_install_missing_tools():
    class FakeChecker:
        def check(self, requirements):
            return [
                {
                    "component": "backend",
                    "name": "postgresql",
                    "requested_version": None,
                    "detected_version": None,
                    "status": "not_installed",
                }
            ]

    client = TestClient(create_local_agent(checker=FakeChecker()))

    response = client.post(
        "/environment/check",
        json={"requirements": [{"component": "backend", "name": "postgresql"}]},
    )

    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "not_installed"