from pathlib import Path


class ToolSet:
    """The tools the agent uses on one project folder."""

    def __init__(self, project_folder, read_limit=20000):
        self._root = Path(project_folder).resolve()
        self._read_limit = read_limit

    def _resolve(self, relative_path):
        if Path(relative_path).anchor:  # a drive or a leading slash: an absolute path
            raise ValueError("Access denied: use a path relative to the project")
        path = (self._root / relative_path).resolve()
        if not path.is_relative_to(self._root):
            raise ValueError("Access denied: path is outside the project")
        return path

    def list_files(self, path="."):
        try:
            entries = sorted(self._resolve(path).iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
            return "\n".join(p.name + ("/" if p.is_dir() else "") for p in entries)
        except Exception as error:
            return f"Error: {error}"

    def read_file(self, path, start=0):
        try:
            text = self._resolve(path).read_text(encoding="utf-8")
            end = start + self._read_limit
            part = text[start:end]
            if end < len(text):
                part += f"\n[more follows: call read_file again with start={end}]"
            return part
        except Exception as error:
            return f"Error: {error}"