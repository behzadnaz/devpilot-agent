import inspect
import json
from pathlib import Path

from app.tool_schemas import ToolSchemas
from app.tools import ToolSet

TOOLS_FILE = Path(__file__).resolve().parent.parent / "config" / "tools.json"


class _ToolSchemasTest:
    def test_required_arguments_come_from_the_schemas(self, tmp_path):
        tools_file = tmp_path / "tools.json"
        tools_file.write_text(
            json.dumps(
                [
                    {
                        "type": "function",
                        "function": {
                            "name": "read_file",
                            "description": "Read a file",
                            "parameters": {
                                "type": "object",
                                "properties": {"path": {"type": "string"}},
                                "required": ["path"],
                            },
                        },
                    },
                    {
                        "type": "function",
                        "function": {
                            "name": "list_files",
                            "description": "List a folder",
                            "parameters": {
                                "type": "object",
                                "properties": {"path": {"type": "string"}},
                                "required": [],
                            },
                        },
                    },
                ]
            )
        )

        schemas = ToolSchemas.load(tools_file)

        assert schemas.required_arguments() == {"read_file": ["path"], "list_files": []}, "tool name to the arguments it needs"
        assert [tool["function"]["name"] for tool in schemas.tools] == ["read_file", "list_files"], "the list the model gets"

    def test_every_tool_in_tools_json_exists_in_the_toolset(self):
        schemas = ToolSchemas.load(TOOLS_FILE)

        for name, required in schemas.required_arguments().items():
            assert hasattr(ToolSet, name), f"{name} is a method of ToolSet"
            parameters = inspect.signature(getattr(ToolSet, name)).parameters
            for argument in required:
                assert argument in parameters, f"{name} takes {argument}"