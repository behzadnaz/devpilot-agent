import time


class DemoAgent:
    """A fake agent that publishes a scripted run. The real AgentLoop replaces it later."""

    def __init__(self, pause_seconds=1.0):
        self._pause_seconds = pause_seconds

    def run(self, message, events):
        steps = [
            ("status", "step 1 of 20"),
            ("tool_call", "list_files ."),
            ("tool_result", "(the project is empty)"),
            ("status", "step 2 of 20"),
            ("tool_call", "create_file calculator.py"),
            ("tool_result", "File calculator.py was created."),
            ("diff", "+ calculator.py\n+ def add(a, b):\n+     return a + b"),
            ("message", f"Done. I handled your task: {message}"),
        ]
        for event_type, text in steps:
            events.publish(event_type, text)
            time.sleep(self._pause_seconds)