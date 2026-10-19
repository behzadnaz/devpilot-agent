
import shutil
import web.app as web_app_module

from pathlib import Path
from app.tool_schemas import ToolSchemas
from fastapi.testclient import TestClient
from app._llm_stub import _LLMStub, final_message, tool_call
from app.approval import ApprovalManager
from app.events import EventStream
from web._agent_stub import _AgentStub
from web._project_registry_stub import _ProjectRegistryStub
from web.app import create_app


class _AppTest:
    def test_start_task_request_streams_the_events(self):
        agent = _AgentStub()
        client = TestClient(create_app(agent, start=lambda job: job()))

        started = client.post(
            "/tasks",
            json={"message": "Create a calculator"},
        )
        everything = client.get("/events").json()
        rest = client.get("/events", params={"after": 1}).json()

        assert started.status_code == 200
        assert agent.run_called_with == "Create a calculator"
        assert everything == {
            "events": [
                {"type": "status", "text": "step 1 of 20"},
                {"type": "message", "text": "Done"},
            ],
            "next": 2,
        }
        assert rest == {
            "events": [{"type": "message", "text": "Done"}],
            "next": 2,
        }

    def test_the_page_is_served(self):
        client = TestClient(create_app(_AgentStub()))

        page = client.get("/")

        assert page.status_code == 200
        assert 'id="projectMessage"' in page.text
        assert 'id="steps"' in page.text

    def test_task_is_sent_to_the_selected_project_agent(self):
        planning_agent = _AgentStub()
        development_agent = _AgentStub()
        registry = _ProjectRegistryStub(
            agents={
                "planning": planning_agent,
                "development": development_agent,
            }
        )
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
        registry = _ProjectRegistryStub(
            agents={
                "planning": planning_agent,
                "development": development_agent,
            }
        )
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

    def test_lists_registered_projects(self):
        registry = _ProjectRegistryStub(
            projects={
                "devpilot": {"workflow": "development"},
                "my-project": {"workflow": "planning"},
            }
        )
        client = TestClient(
            create_app(agent=None, project_registry=registry)
        )

        response = client.get("/projects")

        assert response.status_code == 200
        assert response.json() == {
            "projects": [
                {"id": "devpilot", "workflow": "development"},
                {"id": "my-project", "workflow": "planning"},
            ]
        }

    def test_creates_project_outside_configured_workspace(self, tmp_path):
        workspace = tmp_path / "DevPilot-Workspace"
        workspace.mkdir()

        chosen_folder = tmp_path / "Documents" / "MyNewProject"
        chosen_folder.mkdir(parents=True)

        registry = _ProjectRegistryStub()
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
                "id": "my-new-project",
                "path": str(chosen_folder),
                "workflow": "development",
            },
        )

        assert response.status_code == 201, response.text
        assert response.json() == {
            "id": "my-new-project",
            "workflow": "development",
        }
        assert (
            registry.projects["my-new-project"]["path"]
            == chosen_folder.resolve()
        )

    def test_duplicate_project_creation_returns_conflict(self, tmp_path):
        registry = _ProjectRegistryStub(
            projects={
                "devpilot": {
                    "path": tmp_path / "devpilot",
                    "workflow": "development",
                }
            }
        )
        client = TestClient(
            create_app(agent=None, project_registry=registry)
        )

        response = client.post(
            "/projects",
            json={
                "id": "devpilot",
                "path": str(tmp_path / "replacement"),
                "workflow": "planning",
            },
        )

        assert response.status_code == 409, response.text
        assert response.json()["detail"] == (
            "Project already exists: devpilot"
        )

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

    def test_agent_core_accepts_message_without_creating_project(
        self, tmp_path
    ):
        agent_core = _AgentStub()
        client = TestClient(
            create_app(
                agent_core=agent_core,
                projects_root=tmp_path,
                start=lambda job: job(),
            )
        )

        response = client.post(
            "/agent-core/tasks",
            json={"message": "Explain your architecture"},
        )

        assert response.status_code == 200
        assert response.json() == {
            "started": True,
            "scope": "agent_core",
        }
        assert agent_core.run_called_with == "Explain your architecture"
        assert client.get("/agent-core/events").json()["events"] == [
            {"type": "status", "text": "step 1 of 20"},
            {"type": "message", "text": "Done"},
        ]
        assert client.get("/events").json()["events"] == []

    def test_page_has_separate_agent_core_and_project_chats(self):
        client = TestClient(create_app(_AgentStub()))

        page = client.get("/")

        assert page.status_code == 200
        assert 'id="agentCoreMessage"' in page.text
        assert 'id="projectMessage"' in page.text
        assert 'id="projectLog"' in page.text

    def test_approval_endpoint_accepts_a_decision(self):
        client = TestClient(create_app(_AgentStub()))

        response = client.post(
            "/approvals/test-request",
            json={"approved": False},
        )

        assert response.status_code == 200
        assert response.json() == {
            "request_id": "test-request",
            "approved": False,
        }

    def test_approval_endpoint_resolves_pending_request(self):
        manager = ApprovalManager()
        request_id = manager.create_request(
            action="create_file",
            details={"path": "example.txt"},
        )
        client = TestClient(
            create_app(_AgentStub(), approval_manager=manager)
        )

        response = client.post(
            f"/approvals/{request_id}",
            json={"approved": False},
        )

        assert response.status_code == 200
        assert response.json() == {
            "request_id": request_id,
            "approved": False,
        }
        assert manager.wait_for_decision(request_id) is False

    def test_pending_approvals_endpoint_returns_unresolved_requests(self):
        manager = ApprovalManager()
        request_id = manager.create_request(
            action="delete_file",
            details={"path": "example.txt"},
        )
        client = TestClient(
            create_app(agent=None, approval_manager=manager)
        )

        response = client.get("/approvals")

        assert response.status_code == 200
        assert response.json() == {
            "requests": [
                {
                    "request_id": request_id,
                    "action": "delete_file",
                    "details": {"path": "example.txt"},
                }
            ]
        }

    def test_build_project_registry_returns_the_configured_projects(
        self, tmp_path
    ):
        registry = web_app_module.build_project_registry(
            {
                "demo": {
                    "path": tmp_path,
                    "workflow": "software-development",
                }
            },
            llm=_LLMStub([]),
        )

        assert registry.get_config("demo")["path"] == tmp_path
        assert registry.get_agent("demo") is not None

    def test_agents_of_the_registry_can_run_the_command_in_limits_yaml(
        self, tmp_path
    ):
        llm = _LLMStub(
            [
                tool_call("run_command", command="pytest -q"),
                final_message("Done."),
            ]
        )
        registry = web_app_module.build_project_registry(
            {
                "demo": {
                    "path": tmp_path,
                    "workflow": "software-development",
                }
            },
            llm=llm,
        )
        events = EventStream()

        registry.get_agent("demo").run("Run the tests", events)

        result = [
            event.text
            for event in events.since(0)
            if event.type == "tool_result"
        ][0]
        assert "exit code" in result

    def test_chat_request_models_preserve_message_mode_and_tags(self):
        agent_core_request = web_app_module.AgentCoreRequest(
            message="Explain the architecture",
            mode="ask",
            tags=["ask"],
        )
        project_request = web_app_module.TaskRequest(
            message="Change the login function",
            project_id="demo",
            mode="change",
            tags=["change"],
        )

        assert agent_core_request.mode == "ask"
        assert agent_core_request.tags == ["ask"]
        assert project_request.mode == "change"
        assert project_request.tags == ["change"]

    def test_task_forwards_message_mode_and_tags_to_selected_agent(self):
        development_agent = _AgentStub()
        registry = _ProjectRegistryStub(
            agents={"development": development_agent}
        )
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
                "message": "Update the login function",
                "mode": "change",
                "tags": ["change"],
            },
        )

        assert response.status_code == 200
        assert development_agent.run_called_with == "Update the login function"
        assert development_agent.run_mode == "change"
        assert development_agent.run_tags == ["change"]

    def test_agent_core_forwards_message_mode_and_tags(self, tmp_path):
        agent_core = _AgentStub()
        client = TestClient(
            create_app(
                agent_core=agent_core,
                projects_root=tmp_path,
                start=lambda job: job(),
            )
        )

        response = client.post(
            "/agent-core/tasks",
            json={
                "message": "Explain the architecture",
                "mode": "ask",
                "tags": ["ask"],
            },
        )

        assert response.status_code == 200
        assert agent_core.run_called_with == "Explain the architecture"
        assert agent_core.run_mode == "ask"
        assert agent_core.run_tags == ["ask"]

    def test_project_task_publishes_error_when_agent_crashes(self):
        class FailingAgent:
            def run(self, message, events, mode="ask", tags=None):
                raise RuntimeError("Simulated Ollama failure")

        registry = _ProjectRegistryStub(
            agents={"default": FailingAgent()}
        )
        client = TestClient(
            create_app(
                project_registry=registry,
                start=lambda job: job(),
            )
        )

        response = client.post(
            "/tasks",
            json={"project_id": "default", "message": "hi"},
        )

        assert response.status_code == 200
        events = client.get("/events").json()["events"]
        assert events[-1] == {
            "type": "message",
            "text": "Agent failed: Simulated Ollama failure",
        }

    def test_agent_core_publishes_error_when_agent_crashes(self, tmp_path):
        class FailingAgent:
            def run(self, message, events, mode="ask", tags=None):
                raise RuntimeError("Simulated Ollama failure")

        client = TestClient(
            create_app(
                agent_core=FailingAgent(),
                projects_root=tmp_path,
                start=lambda job: job(),
            )
        )

        response = client.post(
            "/agent-core/tasks",
            json={"message": "hi"},
        )

        assert response.status_code == 200
        events = client.get("/agent-core/events").json()["events"]
        assert events[-1] == {
            "type": "message",
            "text": "Agent failed: Simulated Ollama failure",
        }

    def test_project_ai_backend_receives_exact_frontend_message(self):
        project_agent = _AgentStub()
        registry = _ProjectRegistryStub(
            agents={"development": project_agent}
        )
        client = TestClient(
            create_app(
                project_registry=registry,
                start=lambda job: job(),
            )
        )

        frontend_payload = {
            "project_id": "development",
            "message": "Please explain the login function.",
            "mode": "ask",
            "tags": ["ask"],
        }

        response = client.post("/tasks", json=frontend_payload)

        assert response.status_code == 200
        assert project_agent.run_called_with == (
            "Please explain the login function."
        )
        assert project_agent.run_mode == "ask"
        assert project_agent.run_tags == ["ask"]

    def test_agent_core_backend_receives_exact_frontend_message(self, tmp_path):
        agent_core = _AgentStub()
        client = TestClient(
            create_app(
                agent_core=agent_core,
                projects_root=tmp_path,
                start=lambda job: job(),
            )
        )

        frontend_payload = {
            "message": "Please explain the Agent Core architecture.",
            "mode": "ask",
            "tags": ["ask"],
        }

        response = client.post(
            "/agent-core/tasks",
            json=frontend_payload,
        )

        assert response.status_code == 200
        assert agent_core.run_called_with == (
            "Please explain the Agent Core architecture."
        )
        assert agent_core.run_mode == "ask"
        assert agent_core.run_tags == ["ask"]

    def test_deletes_project_and_its_folder(self, tmp_path):
        project_folder = tmp_path / "my-project"
        project_folder.mkdir()
        (project_folder / "main.py").write_text(
            "print('hello')", encoding="utf-8"
        )

        another_folder = tmp_path / "another-project"
        another_folder.mkdir()

        registry = _ProjectRegistryStub(
            projects={
                "my-project": {
                    "path": str(project_folder),
                    "workflow": "software_development",
                },
                "another-project": {
                    "path": str(another_folder),
                    "workflow": "software_development",
                },
            }
        )
        client = TestClient(
            create_app(
                project_registry=registry,
                projects_root=tmp_path,
            )
        )

        response = client.delete("/projects/my-project")

        assert response.status_code == 200
        assert "my-project" not in registry.projects
        assert "another-project" in registry.projects
        assert not project_folder.exists()
        assert another_folder.is_dir()

    def test_delete_project_moves_folder_to_recycle_bin_and_removes_it_from_explore(
        self, tmp_path, monkeypatch
    ):
        workspace = tmp_path / "workspace"
        project_path = workspace / "my-project"
        other_path = workspace / "other-project"
        recycle_bin = tmp_path / "recycle-bin"

        project_path.mkdir(parents=True)
        other_path.mkdir()
        recycle_bin.mkdir()

        registry = _ProjectRegistryStub(
            projects={
                "my-project": {
                    "path": project_path,
                    "workflow": "software-development",
                },
                "other-project": {
                    "path": other_path,
                    "workflow": "software-development",
                },
            }
        )

        def fake_send2trash(path):
            shutil.move(str(path), str(recycle_bin / Path(path).name))

        monkeypatch.setattr(
            web_app_module,
            "send2trash",
            fake_send2trash,
            raising=False,
        )

        client = TestClient(
            create_app(
                project_registry=registry,
                projects_root=workspace,
            )
        )

        response = client.delete("/projects/my-project")

        assert response.status_code == 200
        assert response.json() == {"deleted": "my-project"}
        assert not project_path.exists()
        assert (recycle_bin / "my-project").is_dir()
        assert other_path.is_dir()
        assert "my-project" not in registry.projects
        assert "other-project" in registry.projects

        listed = client.get("/projects").json()["projects"]
        assert [project["id"] for project in listed] == ["other-project"]

    def test_failed_project_deletion_keeps_project_registered(
        self, tmp_path, monkeypatch
    ):
        workspace = tmp_path / "workspace"
        project_path = workspace / "my-project"
        project_path.mkdir(parents=True)

        registry = _ProjectRegistryStub(
            projects={
                "my-project": {
                    "path": project_path,
                    "workflow": "software-development",
                }
            }
        )

        def fail_to_send_to_trash(path):
            raise OSError("Recycle Bin operation failed")

        monkeypatch.setattr(
            web_app_module,
            "send2trash",
            fail_to_send_to_trash,
            raising=False,
        )

        client = TestClient(
            create_app(
                project_registry=registry,
                projects_root=workspace,
            )
        )

        response = client.delete("/projects/my-project")

        assert response.status_code == 500
        assert project_path.is_dir()
        assert "my-project" in registry.projects

    def test_delete_project_rejects_path_outside_workspace(
        self, tmp_path, monkeypatch
    ):
        workspace = tmp_path / "workspace"
        workspace.mkdir()

        outside_path = tmp_path / "private-project"
        outside_path.mkdir()

        registry = _ProjectRegistryStub(
            projects={
                "private-project": {
                    "path": outside_path,
                    "workflow": "software-development",
                }
            }
        )

        def unexpected_trash_call(path):
            raise AssertionError("An outside folder must never be moved")

        monkeypatch.setattr(
            web_app_module,
            "send2trash",
            unexpected_trash_call,
            raising=False,
        )

        client = TestClient(
            create_app(
                project_registry=registry,
                projects_root=workspace,
            )
        )

        response = client.delete("/projects/private-project")

        assert response.status_code == 400
        assert outside_path.is_dir()
        assert "private-project" in registry.projects

    def test_project_prompt_prioritizes_existing_technology_before_installing(self):
        prompt = web_app_module.SYSTEM_PROMPT.lower()

        assert "inspect the existing project" in prompt
        assert "reuse" in prompt
        assert "dependencies" in prompt
        assert "approval" in prompt

    def test_project_prompt_requires_stack_assessment_before_recommending(self):
        prompt = web_app_module.SYSTEM_PROMPT.lower()

        assert "frameworks" in prompt
        assert "available tools" in prompt
        assert "before recommending" in prompt

    def test_project_tools_explain_how_to_identify_existing_stack(self):
        schemas = ToolSchemas.load("config/tools.json").tools
        descriptions = {
            tool["function"]["name"]: tool["function"]["description"].lower()
            for tool in schemas
        }

        assert "configuration" in descriptions["list_files"]
        assert "technology stack" in descriptions["read_file"]

    def test_changing_topic_in_open_new_project_refreshes_recommendations(
            self, tmp_path
    ):
        # Arrange
        client = TestClient(
            create_app(projects_root=tmp_path)
        )

        response = client.get("/")
        assert response.status_code == 200

        # Act and assert:
        # Submit topic A, capture its recommendations,
        # submit topic B without closing the panel,
        # and verify recommendations are regenerated for topic B.

    def test_reopening_new_project_generates_fresh_recommendations(
            self, tmp_path
    ):
        # Arrange
        client = TestClient(
            create_app(projects_root=tmp_path)
        )

        # Act: open the project creation panel.
        first_response = client.get("/")

        # Open the page again as a new project panel.
        second_response = client.get("/")

        # Assert
        assert first_response.status_code == 200
        assert second_response.status_code == 200

    def test_reopening_new_project_starts_with_fresh_recommendations(
        self, tmp_path
    ):
        client = TestClient(
            create_app(projects_root=tmp_path)
        )

        first_response = client.get("/")
        second_response = client.get("/")

        assert first_response.status_code == 200
        assert second_response.status_code == 200


    def test_stack_advice_returns_recommendations(self):
        class FakeStackAdvisor:
            def __call__(self, description):
                assert description == "Build an online bookstore"
                return [
                    {
                        "stack": "React + FastAPI + PostgreSQL",
                        "reason": "React for the interface, FastAPI for the API, and PostgreSQL for data.",
                    }
                ]

        client = TestClient(
            create_app(stack_advisor=FakeStackAdvisor())
        )

        response = client.post(
            "/stack-advice",
            json={"description": "Build an online bookstore"},
        )

        assert response.status_code == 200
        assert response.json() == {
            "suggestions": [
                {
                    "stack": "React + FastAPI + PostgreSQL",
                    "reason": "React for the interface, FastAPI for the API, and PostgreSQL for data.",
                }
            ]
        }

    def test_stack_advice_rejects_empty_description(self):
        client = TestClient(create_app())

        response = client.post(
            "/stack-advice",
            json={"description": "   "},
        )

        assert response.status_code == 400
        assert response.json()["detail"] == (
            "Project description is required."
        )

    def test_stack_advice_returns_error_when_advisor_fails(self):
        class FailingStackAdvisor:
            def __call__(self, description):
                raise RuntimeError("AI service unavailable")

        client = TestClient(
            create_app(stack_advisor=FailingStackAdvisor())
        )

        response = client.post(
            "/stack-advice",
            json={"description": "Build an online bookstore"},
        )

        assert response.status_code == 502
        assert response.json()["detail"] == (
            "Could not generate stack recommendations."
        )

    def test_changing_topic_in_open_new_project_can_submit_new_task(
        self, tmp_path
    ):
        messages = []

        class FakeAgent:
            def run(self, message, events, mode="ask", tags=None):
                messages.append(message)

        def run_immediately(job):
            job()

        client = TestClient(
            create_app(
                agent=FakeAgent(),
                start=run_immediately,
                projects_root=tmp_path,
            )
        )

        first_response = client.post(
            "/tasks",
            json={
                "message": "Build a task management application",
                "project_id": "default",
            },
        )

        second_response = client.post(
            "/tasks",
            json={
                "message": "Build an AI document analysis application",
                "project_id": "default",
            },
        )

        assert first_response.status_code == 200
        assert second_response.status_code == 200
        assert messages == [
            "Build a task management application",
            "Build an AI document analysis application",
        ]

    def test_stack_advice_uses_selected_project_path(self, tmp_path):
        project_path = tmp_path / "bookstore"
        project_path.mkdir()
        (project_path / "package.json").write_text(
            '{"dependencies": {"react": "^18.0.0"}}',
            encoding="utf-8",
        )

        class FakeProjectRegistry:
            def get_config(self, project_id):
                assert project_id == "bookstore"
                return {
                    "path": project_path,
                    "workflow": "software-development",
                }

        class FakeStackAdvisor:
            def __init__(self):
                self.description = None
                self.project_path = None

            def __call__(self, description, project_path=None):
                self.description = description
                self.project_path = project_path
                return [
                    {
                        "stack": "React + existing backend",
                        "reason": "Reuse the existing React dependency.",
                    }
                ]

        advisor = FakeStackAdvisor()
        client = TestClient(
            create_app(
                project_registry=FakeProjectRegistry(),
                stack_advisor=advisor,
            )
        )

        response = client.post(
            "/stack-advice",
            json={
                "description": "Build an online bookstore",
                "project_id": "bookstore",
            },
        )

        assert response.status_code == 200
        assert advisor.description == "Build an online bookstore"
        assert advisor.project_path == project_path.resolve()






