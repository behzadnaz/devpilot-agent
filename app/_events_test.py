import pytest

from app.events import Event, EventStream


class _EventStreamTest:
    def test_each_step_is_published_as_a_typed_event(self):
        stream = EventStream()

        stream.publish("tool_call", "list_files .")
        stream.publish("tool_result", "docs/\nREADME.md")

        assert stream.since(0) == [
            Event("tool_call", "list_files ."),
            Event("tool_result", "docs/\nREADME.md"),
        ], "all events, in order"
        assert stream.since(1) == [Event("tool_result", "docs/\nREADME.md")], "only the events after the first"

    def test_event_types_are_tool_call_tool_result_message_diff_and_status(self):
        stream = EventStream()

        for event_type in ["tool_call", "tool_result", "message", "diff", "status"]:
            stream.publish(event_type, "x")
        with pytest.raises(ValueError) as error:
            stream.publish("shout", "x")

        assert [event.type for event in stream.since(0)] == [
            "tool_call",
            "tool_result",
            "message",
            "diff",
            "status",
        ], "the five types are accepted"
        assert "shout" in str(error.value), "the message names the unknown type"


class _EventTest:
    def test_value_object(self):
        event = Event(type="status", text="step 1 of 20")

        assert event == Event(type="status", text="step 1 of 20"), "same values are equal"
        assert event != Event(type="message", text="step 1 of 20"), "different type"
        assert event != Event(type="status", text="step 2 of 20"), "different text"
        assert hash(event) == hash(Event(type="status", text="step 1 of 20")), "hash"
        assert repr(event) == "Event(type='status', text='step 1 of 20')", "repr"
        assert event != None, "not equal to None"  # noqa: E711