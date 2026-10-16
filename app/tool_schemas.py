import json


class ToolSchemas:
    """The tool descriptions the model sees, read from config/tools.json."""

    def __init__(self, tools):
        self.tools = tools

    @staticmethod
    def load(path):
        with open(path, encoding="utf-8") as file:
            return ToolSchemas(json.load(file))

    def required_arguments(self):
        return {
            tool["function"]["name"]: list(tool["function"]["parameters"].get("required", []))
            for tool in self.tools
        }