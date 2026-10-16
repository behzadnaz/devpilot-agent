from fastapi.testclient import TestClient
from web._agent_stub import _AgentStub
from app.tools import ToolSet
from app.agent_loop import AgentLoop
from app.reply_parser import ReplyParser
from app._llm_stub import _LLMStub, final_message
from app.project_registry import ProjectRegistry
from pathlib import Path
import web.app as web_app_module
from web.app import create_app

class _ProjectRegistryStub:
    """Provides a separate agent for each project."""

    def __init__(self, agents):
        self._agents = agents

    def get_agent(self, project_id):
        return self._agents[project_id]

class _AppTest:
    def test_start_task_request_streams_the_events(self):
        agent = _AgentStub()
        client = TestClient(create_app(agent, start=lambda job: job()))

        started = client.post("/tasks", json={"message": "Create a calculator"})
        everything = client.get("/events").json()
        rest = client.get("/events", params={"after": 1}).json()

        assert started.status_code == 200, "the task starts"
        assert agent.run_called_with == "Create a calculator", "the agent got the message"
        assert everything == {
            "events": [
                {"type": "status", "text": "step 1 of 20"},
                {"type": "message", "text": "Done"},
            ],
            "next": 2,
        }, "all events"
        assert rest == {"events": [{"type": "message", "text": "Done"}], "next": 2}, "only the new events"

    def test_the_page_is_served(self):
        client = TestClient(create_app(_AgentStub()))

        page = client.get("/")

        assert page.status_code == 200, "the page is found"
        assert 'id="message"' in page.text, "the page has a box for the message"
        assert 'id="steps"' in page.text, "the page has a list for the steps"

    def test_task_is_sent_to_the_selected_project_agent(self):
        planning_agent = _AgentStub()
        development_agent = _AgentStub()

        registry = _ProjectRegistryStub({
            "planning": planning_agent,
            "development": development_agent,
        })

        client = TestClient(
            create_app(
                project_registry=registry,
                start=lambda job: job(),
            )
        )

        response = client.post(
            "/tasks",
            json={
                "project_id": "development",
                "message": "Write a unit test",
            },
        )

        assert response.status_code == 200
        assert development_agent.run_called_with == "Write a unit test"
        assert planning_agent.run_called_with is None

    def test_unknown_project_does_not_run_any_agent(self):
        planning_agent = _AgentStub()
        development_agent = _AgentStub()

        registry = _ProjectRegistryStub({
            "planning": planning_agent,
            "development": development_agent,
        })

        client = TestClient(
            create_app(
                project_registry=registry,
                start=lambda job: job(),
            )
        )

        response = client.post(
            "/tasks",
            json={
                "project_id": "unknown-project",
                "message": "Change a function",
            },
        )

        assert response.status_code == 404
        assert planning_agent.run_called_with is None
        assert development_agent.run_called_with is None

    def test_each_project_uses_its_own_agent(self, tmp_path):
        planning_path = tmp_path / "planning"
        development_path = tmp_path / "development"
        planning_path.mkdir()
        development_path.mkdir()

        planning_path.joinpath("planning.txt").write_text("Planning project")
        development_path.joinpath("code.py").write_text("print('development')")

        required = {
            "list_files": [],
            "read_file": ["path"],
            "create_file": ["path", "content"],
        }

        def make_agent(path):
            return AgentLoop(
                _LLMStub([final_message("Finished")]),
                ToolSet(path),
                ReplyParser(required),
                tool_schemas=[],
                system_prompt="You are a project-specific agent.",
            )

        planning_agent = make_agent(planning_path)
        development_agent = make_agent(development_path)

        registry = _ProjectRegistryStub({
            "planning": planning_agent,
            "development": development_agent,
        })

        client = TestClient(
            create_app(
                project_registry=registry,
                start=lambda job: job(),
            )
        )

        response = client.post(
            "/tasks",
            json={
                "project_id": "planning",
                "message": "Review this project",
            },
        )

        assert response.status_code == 200
        assert (planning_path / "planning.txt").exists()
        assert not (planning_path / "code.py").exists()
        assert (development_path / "code.py").exists()
        assert not (development_path / "planning.txt").exists()

    def test_lists_registered_projects(self):
        class ProjectRegistryStub:
            def list_projects(self):
                return {
                    "devpilot": {
                        "workflow": "development",
                    },
                    "my-project": {
                        "workflow": "planning",
                    },
                }

        app = create_app(
            agent=None,
            project_registry=ProjectRegistryStub(),
        )
        client = TestClient(app)

        response = client.get("/projects")

        assert response.status_code == 200
        assert response.json() == {
            "projects": [
                {"id": "devpilot", "workflow": "development"},
                {"id": "my-project", "workflow": "planning"},
            ]
        }

    def test_creates_project_through_api(self, tmp_path):
        class ProjectRegistryStub:
            def __init__(self):
                self.projects = {
                    "devpilot": {
                        "path": tmp_path / "devpilot",
                        "workflow": "development",
                    }
                }

            def list_projects(self):
                return self.projects

            def add_project(self, project_id, config):
                if project_id in self.projects:
                    raise ValueError(f"Project already exists: {project_id}")
                self.projects[project_id] = dict(config)

        registry = ProjectRegistryStub()
        app = create_app(agent=None, project_registry=registry)
        client = TestClient(app)

        response = client.post(
            "/projects",
            json={
                "id": "my-project",
                "path": str(tmp_path / "my-project"),
                "workflow": "planning",
            },
        )

        assert response.status_code == 201
        assert response.json() == {
            "id": "my-project",
            "workflow": "planning",
        }

    def test_duplicate_project_creation_returns_conflict(self, tmp_path):
        class ProjectRegistryStub:
            def __init__(self):
                self.projects = {
                    "devpilot": {
                        "path": tmp_path / "devpilot",
                        "workflow": "development",
                    }
                }

            def add_project(self, project_id, config):
                if project_id in self.projects:
                    raise ValueError(
                        f"Project already exists: {project_id}"
                    )
                self.projects[project_id] = dict(config)

            def list_projects(self):
                return self.projects

        app = create_app(
            agent=None,
            project_registry=ProjectRegistryStub(),
        )
        client = TestClient(app)

        response = client.post(
            "/projects",
            json={
                "id": "devpilot",
                "path": str(tmp_path / "replacement"),
                "workflow": "planning",
            },
        )

        assert response.status_code == 409
        assert response.json()["detail"] == (
            "Project already exists: devpilot"
        )

    def test_rejects_project_path_outside_workspace(self, tmp_path):
        workspace = tmp_path / "projects"
        workspace.mkdir()

        outside_path = tmp_path / "private"
        outside_path.mkdir()

        class ProjectRegistryStub:
            def __init__(self):
                self.add_called = False

            def add_project(self, project_id, config):
                self.add_called = True

        registry = ProjectRegistryStub()

        client = TestClient(
            create_app(
                agent=None,
                project_registry=registry,
                projects_root=workspace,
            )
        )

        response = client.post(
            "/projects",
            json={
                "id": "my-project",
                "path": str(outside_path),
                "workflow": "development",
            },
        )

        assert response.status_code == 400
        assert registry.add_called is False

    def test_app_can_start_with_project_registry(self, tmp_path):
        registry = ProjectRegistry({
            "demo": {
                "path": Path("/tmp/devpilot-demo"),
                "workflow": "software-development",
            }
        })

        app = create_app(project_registry=registry)

        assert app is not None

    def test_app_startup_wires_real_agent_components(monkeypatch, tmp_path):
        class FakeAgent:
            def run(self, message, stream):
                pass

        class FakeFactory:
            def __call__(self, project_id, config):
                return FakeAgent()

        registry = ProjectRegistry(
            {
                "demo": {
                    "path": tmp_path,
                    "workflow": "software-development",
                }
            },
            agent_factory=FakeFactory(),
        )

        app = create_app(project_registry=registry)

        assert app is not None
        assert registry.get_agent("demo").__class__ is FakeAgent

    def test_create_application_wires_project_registry(monkeypatch, tmp_path):
        class FakeAgent:
            def run(self, message, stream):
                pass

        class FakeFactory:
            def __call__(self, project_id, config):
                return FakeAgent()

        registry = ProjectRegistry(
            {
                "demo": {
                    "path": tmp_path,
                    "workflow": "software-development",
                }
            },
            agent_factory=FakeFactory(),
        )

        app = web_app_module.create_app(project_registry=registry)

        assert app is not None
        assert registry.get_agent("demo").__class__ is FakeAgent

    def test_build_project_registry_connects_agent_factory(self, monkeypatch, tmp_path):
        import web.app as web_app_module

        class FakeLLM:
            pass

        class FakeToolSchemas:
            tools = []

            def required_arguments(self):
                return {}

        monkeypatch.setattr(
            web_app_module,
            "load_model_settings",
            lambda: object(),
            raising=False,
        )
        monkeypatch.setattr(
            web_app_module,
            "create_llm_client",
            lambda settings: FakeLLM(),
            raising=False,
        )
        monkeypatch.setattr(
            web_app_module,
            "load_tool_schemas",
            lambda: FakeToolSchemas(),
            raising=False,
        )

        registry = web_app_module.build_project_registry(
            {"demo": {"path": tmp_path, "workflow": "software-development"}}
        )

        assert registry.get_config("demo")["path"] == tmp_path
        assert registry.get_agent("demo") is not None

    def test_creates_workspace_through_api(self, tmp_path):
        workspace = tmp_path / "DevPilot-Workspace"

        client = TestClient(create_app(projects_root=workspace))

        response = client.post(
            "/workspace",
            json={"path": str(workspace)},
        )

        assert response.status_code == 201
        assert response.json() == {"path": str(workspace)}
        assert workspace.is_dir()

    def test_selects_project_folder_through_native_dialog(
            self, tmp_path, monkeypatch
    ):
        from web import app as web_app_module

        monkeypatch.setattr(
            web_app_module,
            "select_folder_dialog",
            lambda: str(tmp_path),
            raising=False,
        )

        client = TestClient(create_app(projects_root=tmp_path))

        response = client.get("/select-folder")

        assert response.status_code == 200
        assert response.json() == {"path": str(tmp_path)}







