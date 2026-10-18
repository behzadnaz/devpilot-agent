from fastapi.testclient import TestClient

import web.app as web_app_module
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
        registry = _ProjectRegistryStub(agents={"planning": planning_agent, "development": development_agent})
        client = TestClient(create_app(project_registry=registry, start=lambda job: job()))

        response = client.post("/tasks", json={"project_id": "development", "message": "Write a unit test"})

        assert response.status_code == 200, "the task starts"
        assert development_agent.run_called_with == "Write a unit test", "the selected agent got the message"
        assert planning_agent.run_called_with is None, "the other agent got nothing"

    def test_unknown_project_does_not_run_any_agent(self):
        planning_agent = _AgentStub()
        development_agent = _AgentStub()
        registry = _ProjectRegistryStub(agents={"planning": planning_agent, "development": development_agent})
        client = TestClient(create_app(project_registry=registry, start=lambda job: job()))

        response = client.post("/tasks", json={"project_id": "unknown-project", "message": "Change a function"})

        assert response.status_code == 404, "an unknown project is not found"
        assert planning_agent.run_called_with is None, "the planning agent got nothing"
        assert development_agent.run_called_with is None, "the development agent got nothing"

    def test_lists_registered_projects(self):
        registry = _ProjectRegistryStub(
            projects={"devpilot": {"workflow": "development"}, "my-project": {"workflow": "planning"}}
        )
        client = TestClient(create_app(agent=None, project_registry=registry))

        response = client.get("/projects")

        assert response.status_code == 200, "the list is returned"
        assert response.json() == {
            "projects": [
                {"id": "devpilot", "workflow": "development"},
                {"id": "my-project", "workflow": "planning"},
            ]
        }, "every project with its workflow"

    def test_creates_project_through_api(self, tmp_path):
        registry = _ProjectRegistryStub(projects={"devpilot": {"path": tmp_path / "devpilot", "workflow": "development"}})
        client = TestClient(create_app(agent=None, project_registry=registry))

        response = client.post(
            "/projects",
            json={"id": "my-project", "path": str(tmp_path / "my-project"), "workflow": "planning"},
        )

        assert response.status_code == 201, "the project is created"
        assert response.json() == {"id": "my-project", "workflow": "planning"}, "the reply names the project"
        assert "my-project" in registry.projects, "the registry has the new project"

    def test_duplicate_project_creation_returns_conflict(self, tmp_path):
        registry = _ProjectRegistryStub(projects={"devpilot": {"path": tmp_path / "devpilot", "workflow": "development"}})
        client = TestClient(create_app(agent=None, project_registry=registry))

        response = client.post(
            "/projects",
            json={"id": "devpilot", "path": str(tmp_path / "replacement"), "workflow": "planning"},
        )

        assert response.status_code == 409, "a name that exists is a conflict"
        assert response.json()["detail"] == "Project already exists: devpilot", "the reason"

    def test_rejects_project_path_outside_workspace(self, tmp_path):
        workspace = tmp_path / "projects"
        workspace.mkdir()
        outside_path = tmp_path / "private"
        outside_path.mkdir()
        registry = _ProjectRegistryStub()
        client = TestClient(create_app(agent=None, project_registry=registry, projects_root=workspace))

        response = client.post(
            "/projects",
            json={"id": "my-project", "path": str(outside_path), "workflow": "development"},
        )

        assert response.status_code == 400, "a path outside the workspace is refused"
        assert registry.add_project_called_with is None, "nothing was added to the registry"

    def test_creates_workspace_through_api(self, tmp_path):
        workspace = tmp_path / "DevPilot-Workspace"
        client = TestClient(create_app(projects_root=workspace))

        response = client.post("/workspace", json={"path": str(workspace)})

        assert response.status_code == 201, "the workspace is created"
        assert response.json() == {"path": str(workspace)}, "the reply names the path"
        assert workspace.is_dir(), "the folder exists"

    def test_selects_project_folder_through_native_dialog(self, tmp_path, monkeypatch):
        # Replace monkeypatch with an injected select_folder once create_app accepts one.
        monkeypatch.setattr(web_app_module, "select_folder_dialog", lambda: str(tmp_path), raising=False)
        client = TestClient(create_app(projects_root=tmp_path))

        response = client.get("/select-folder")

        assert response.status_code == 200, "the dialog result is returned"
        assert response.json() == {"path": str(tmp_path)}, "the chosen folder"

    def test_agent_core_accepts_message_without_creating_project(self, tmp_path):
        agent_core = _AgentStub()
        client = TestClient(create_app(agent_core=agent_core, projects_root=tmp_path, start=lambda job: job()))

        response = client.post("/agent-core/tasks", json={"message": "Explain your architecture"})

        assert response.status_code == 200, "the message is accepted"
        assert response.json() == {"started": True, "scope": "agent_core"}, "the reply names the scope"
        assert agent_core.run_called_with == "Explain your architecture", "the core agent got the message"
        assert client.get("/agent-core/events").json()["events"] == [
            {"type": "status", "text": "step 1 of 20"},
            {"type": "message", "text": "Done"},
        ], "the core chat has its events"
        assert client.get("/events").json()["events"] == [], "the project chat has none"

    def test_page_has_separate_agent_core_and_project_chats(self):
        client = TestClient(create_app(_AgentStub()))

        page = client.get("/")

        assert page.status_code == 200, "the page is found"
        assert 'id="agentCoreMessage"' in page.text, "the core chat has its message box"
        assert 'id="projectMessage"' in page.text, "the project chat has its message box"
        assert 'id="projectChat"' in page.text, "the project chat has its log"

    def test_approval_endpoint_accepts_a_decision(self):
        client = TestClient(create_app(_AgentStub()))

        response = client.post("/approvals/test-request", json={"approved": False})

        assert response.status_code == 200, "the decision is accepted"
        assert response.json() == {"request_id": "test-request", "approved": False}, "the reply repeats the decision"

    def test_approval_endpoint_resolves_pending_request(self):
        manager = ApprovalManager()
        request_id = manager.create_request(action="create_file", details={"path": "example.txt"})
        client = TestClient(create_app(_AgentStub(), approval_manager=manager))

        response = client.post(f"/approvals/{request_id}", json={"approved": False})

        assert response.status_code == 200, "the decision is accepted"
        assert response.json() == {"request_id": request_id, "approved": False}, "the reply repeats the decision"
        assert manager.wait_for_decision(request_id) is False, "the waiting agent gets the decision"

    def test_pending_approvals_endpoint_returns_unresolved_requests(self):
        manager = ApprovalManager()
        request_id = manager.create_request(action="delete_file", details={"path": "example.txt"})
        client = TestClient(create_app(agent=None, approval_manager=manager))

        response = client.get("/approvals")

        assert response.status_code == 200, "the list is returned"
        assert response.json() == {
            "requests": [{"request_id": request_id, "action": "delete_file", "details": {"path": "example.txt"}}]
        }, "the request that is still open"

    def test_build_project_registry_returns_the_configured_projects(self, tmp_path):
        registry = web_app_module.build_project_registry(
            {"demo": {"path": tmp_path, "workflow": "software-development"}},
            llm=_LLMStub([]),
        )

        assert registry.get_config("demo")["path"] == tmp_path, "the project path"
        assert registry.get_agent("demo") is not None, "the registry builds an agent for the project"

    def test_agents_of_the_registry_can_run_the_command_in_limits_yaml(self, tmp_path):
        llm = _LLMStub([tool_call("run_command", command="pytest -q"), final_message("Done.")])
        registry = web_app_module.build_project_registry(
            {"demo": {"path": tmp_path, "workflow": "software-development"}},
            llm=llm,
        )
        events = EventStream()

        registry.get_agent("demo").run("Run the tests", events)

        result = [event.text for event in events.since(0) if event.type == "tool_result"][0]
        assert "exit code" in result, "the command from limits.yaml was run"