
import json
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class LocalEnvironmentClient:
    """HTTP client for a local DevPilot environment agent."""

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8765",
        session=None,
    ):
        parsed = urlsplit(base_url)

        is_loopback = (
            parsed.scheme == "http"
            and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
            and parsed.port is not None
            and parsed.path in {"", "/"}
            and not parsed.query
            and not parsed.fragment
        )

        if not is_loopback:
            raise ValueError(
                "Local agent URL must use HTTP on a loopback address."
            )

        self.base_url = base_url.rstrip("/")
        self.session = session

    def check_environment(self, requirements: list[dict]) -> dict:
        url = f"{self.base_url}/environment/check"
        payload = {"requirements": requirements}

        if self.session is not None:
            response = self.session.post(
                url,
                json=payload,
                timeout=5,
            )
            response.raise_for_status()
            result = response.json()
        else:
            request = Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )

            with urlopen(request, timeout=5) as response:
                result = json.loads(response.read().decode("utf-8"))

        if not isinstance(result, dict) or not isinstance(
            result.get("results"), list
        ):
            raise ValueError(
                "Local agent response must contain a results list."
            )

        return result
