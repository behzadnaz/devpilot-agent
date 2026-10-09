from pathlib import Path


class ToolSet:
    """The tools the agent uses on one project folder."""

    def __init__(self, project_folder):
        self._root = Path(project_folder).resolve()

    def _resolve(self, relative_path):
        if Path(relative_path).anchor:  # a drive or a leading slash: an absolute path
            raise ValueError("Access denied: use a path relative to the project")
        path = (self._root / relative_path).resolve()
        if not path.is_relative_to(self._root):
            raise ValueError("Access denied: path is outside the project")
        return path

    def read_file(self, path):
        try:
            return self._resolve(path).read_text(encoding="utf-8")
        except Exception as error:
            return f"Error: {error}"