from app.demo_agent import DemoAgent
from app.events import Event, EventStream


class _DemoAgentTest:
    def test_publishes_one_event_of_every_type(self):
        stream = EventStream()

        DemoAgent(pause_seconds=0).run("Create a simple calculator", stream)

        events = stream.since(0)
        assert {event.type for event in events} == {
            "tool_call",
            "tool_result",
            "message",
            "diff",
            "status",
        }, "every event type appears"
        assert events[0] == Event("status", "step 1 of 20"), "the run starts with the first step"
        assert events[-1].type == "message", "the run ends with a message"
        assert "Create a simple calculator" in events[-1].text, "the message mentions the task"