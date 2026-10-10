class _AgentStub:
    """Stands in for the agent. It publishes two events and records the message it got."""

    def __init__(self):
        self.run_called_with = None

    def run(self, message, events):
        self.run_called_with = message
        events.publish("status", "step 1 of 20")
        events.publish("message", "Done")