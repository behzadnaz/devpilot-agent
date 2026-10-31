from environment.checker import EnvironmentChecker


def test_reports_installed_tool_and_detected_version(monkeypatch):
    checker = EnvironmentChecker()

    monkeypatch.setattr(
        checker,
        "_detect_version",
        lambda name: "Python 3.12.4",
    )

    result = checker.check_one(
        component="backend",
        name="Python",
        requested_version="3.12",
    )

    assert result["name"] == "Python"
    assert result["detected_version"] == "3.12.4"
    assert result["status"] == "installed"

def test_reports_version_mismatch(monkeypatch):
    checker = EnvironmentChecker()

    monkeypatch.setattr(
        checker,
        "_detect_version",
        lambda name: "Python 3.11.9",
    )

    result = checker.check_one(
        component="backend",
        name="Python",
        requested_version="3.12",
    )

    assert result["status"] == "version_mismatch"

def test_reports_tool_not_installed(monkeypatch):
    checker = EnvironmentChecker()

    monkeypatch.setattr(
        checker,
        "_detect_version",
        lambda name: None,
    )

    result = checker.check_one(
        component="database",
        name="PostgreSQL",
        requested_version="17",
    )

    assert result["status"] == "not_installed"
    assert result["detected_version"] is None

def test_checks_multiple_selected_technologies(monkeypatch):
    checker = EnvironmentChecker()

    versions = {
        "Python": "Python 3.12.4",
        "FastAPI": "FastAPI 0.115.0",
        "PostgreSQL": None,
    }

    monkeypatch.setattr(
        checker,
        "_detect_version",
        lambda name: versions.get(name),
    )

    results = checker.check(
        [
            {
                "component": "backend",
                "name": "Python",
                "version": "3.12",
            },
            {
                "component": "backend",
                "name": "FastAPI",
                "version": "0.115",
            },
            {
                "component": "database",
                "name": "PostgreSQL",
                "version": "17",
            },
        ]
    )

    assert [item["name"] for item in results] == [
        "Python",
        "FastAPI",
        "PostgreSQL",
    ]
    assert [item["status"] for item in results] == [
        "installed",
        "installed",
        "not_installed",
    ]

def test_unknown_technology_returns_check_failed(monkeypatch):
    checker = EnvironmentChecker()

    monkeypatch.setattr(
        checker,
        "_detect_version",
        lambda name: None,
    )

    result = checker.check_one(
        component="backend",
        name="UnknownRuntime",
        requested_version="1.0",
    )

    assert result["status"] == "check_failed"


def test_npm_library_not_globally_installed_reports_not_installed(monkeypatch):
    checker = EnvironmentChecker()

    monkeypatch.setattr(checker, "_npm_globals", lambda: {})
    monkeypatch.setattr(checker, "_detect_version", lambda name: "v24.15.0")

    result = checker.check_one(component="frontend", name="React")

    assert result["status"] == "not_installed"
    assert result["detected_version"] is None
    assert "npm install react" in result["note"]
    assert "Node.js 24.15.0 is available" in result["note"]


def test_npm_library_globally_installed_reports_version(monkeypatch):
    checker = EnvironmentChecker()

    monkeypatch.setattr(
        checker,
        "_npm_globals",
        lambda: {"react": {"version": "18.3.1"}},
    )

    result = checker.check_one(component="frontend", name="React")

    assert result["status"] == "installed"
    assert result["detected_version"] == "18.3.1"


def test_npm_library_without_npm_reports_unavailable(monkeypatch):
    checker = EnvironmentChecker()

    monkeypatch.setattr(checker, "_npm_globals", lambda: None)

    result = checker.check_one(component="frontend", name="React")

    assert result["status"] == "not_installed"
    assert "npm is not available" in result["note"]
