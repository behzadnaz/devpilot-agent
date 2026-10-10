from dataclasses import dataclass

EVENT_TYPES = ("tool_call", "tool_result", "message", "diff", "status")


@dataclass(frozen=True)
class Event:
    type: str
    text: str


class EventStream:
    """The steps of a task, in order. The browser asks for the ones it has not seen."""

    def __init__(self):
        self._events = []

    def publish(self, type, text):
        if type not in EVENT_TYPES:
            raise ValueError(f"Unknown event type: {type}")
        self._events.append(Event(type, text))

    def since(self, index):
        return self._events[index:]