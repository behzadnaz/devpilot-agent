import pytest

from environment.local_client import LocalEnvironmentClient


def test_client_posts_requirements_to_local_agent():
    calls = []

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "results": [
                    {
                        "component": "backend",
                        "name": "Python",
                        "requested_version": "3.12",
                        "detected_version": "3.12.4",
                        "status": "installed",
                    }
                ]
            }

    class FakeSession:
        def post(self, url, json, timeout):
            calls.append(
                {
                    "url": url,
                    "json": json,
                    "timeout": timeout,
                }
            )
            return FakeResponse()

    client = LocalEnvironmentClient(
        base_url="http://127.0.0.1:8765",
        session=FakeSession(),
    )

    result = client.check_environment(
        [
            {
                "component": "backend",
                "name": "Python",
                "version": "3.12",
            }
        ]
    )

    assert calls == [
        {
            "url": "http://127.0.0.1:8765/environment/check",
            "json": {
                "requirements": [
                    {
                        "component": "backend",
                        "name": "Python",
                        "version": "3.12",
                    }
                ]
            },
            "timeout": 5,
        }
    ]
    assert result["results"][0]["status"] == "installed"

def test_client_rejects_non_loopback_http_url():
    with pytest.raises(ValueError, match="loopback"):
        LocalEnvironmentClient(base_url="http://example.com:8765")

def test_client_rejects_invalid_response():
    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"unexpected": []}

    class FakeSession:
        def post(self, url, json, timeout):
            return FakeResponse()

    client = LocalEnvironmentClient(
        base_url="http://127.0.0.1:8765",
        session=FakeSession(),
    )

    with pytest.raises(ValueError, match="results"):
        client.check_environment([])

def test_client_uses_builtin_http_without_requests(monkeypatch):
    import json
    import urllib.request

    calls = []

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b'{"results": []}'

    def fake_urlopen(request, timeout):
        calls.append({
            "url": request.full_url,
            "timeout": timeout,
            "body": json.loads(request.data.decode("utf-8")),
        })
        return FakeResponse()

    monkeypatch.setattr(
        "environment.local_client.urlopen",
        fake_urlopen,
    )

    client = LocalEnvironmentClient()
    result = client.check_environment([])

    assert result == {"results": []}
    assert calls == [{
        "url": "http://127.0.0.1:8765/environment/check",
        "timeout": 5,
        "body": {"requirements": []},
    }]
