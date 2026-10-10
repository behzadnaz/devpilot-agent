from fastapi.testclient import TestClient

from web._agent_stub import _AgentStub
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