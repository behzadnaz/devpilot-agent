class _AgentStub:
    """Stands in for the agent and records the request it receives."""

    def __init__(self):
        self.run_called_with = None
        self.run_mode = None
        self.run_tags = None

    def run(self, message, events, mode=None, tags=None):
        self.run_called_with = message
        self.run_mode = mode
        self.run_tags = tags

        events.publish("status", "step 1 of 20")
        events.publish("message", "Done")