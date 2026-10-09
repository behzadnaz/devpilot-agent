from dataclasses import dataclass

CHARACTERS_PER_TOKEN = 4  # a rough estimate, good enough for this check


@dataclass(frozen=True)
class PreflightResult:
    status: str
    message: str


class Preflight:
    """The checks before a task starts. Later it also checks the git repository."""

    def __init__(self, settings, ollama_client, project_folder):
        self._settings = settings
        self._ollama_client = ollama_client
        self._project_folder = project_folder

    def check(self):
        try:
            self._ollama_client.list()
        except ConnectionError:
            return PreflightResult(
                status="failed",
                message=f"The model cannot be reached at {self._settings.endpoint}. Is Ollama running?",
            )
        return PreflightResult(status="ok", message="")

    def check_context_window(self, system_prompt, tool_list):
        needed = (len(system_prompt) + len(tool_list)) // CHARACTERS_PER_TOKEN
        allowed = self._settings.context_size // 2  # the other half is kept free for the history
        if needed > allowed:
            return PreflightResult(
                status="failed",
                message=(
                    f"The system prompt and the tool list need about {needed} tokens, but only "
                    f"{allowed} fit in the context window of {self._settings.context_size} tokens. "
                    "Raise context_size in config/model.yaml or shorten the prompt."
                ),
            )
        return PreflightResult(status="ok", message="")