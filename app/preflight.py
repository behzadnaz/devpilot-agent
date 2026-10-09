from dataclasses import dataclass


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