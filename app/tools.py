import subprocess
from pathlib import Path

from app.limits import Limits


class ToolSet:
    """The tools the agent uses on one project folder."""

    def __init__(self, project_folder, read_limit=20000, limits=None):
        self._root = Path(project_folder).resolve()
        self._read_limit = read_limit
        self._limits = limits or Limits()

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

    def create_file(self, path, content):
        try:
            target = self._resolve(path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            return f"File {path} was created."
        except Exception as error:
            return f"Error: {error}"

    def edit_file(self, path, old_text, new_text):
        try:
            target = self._resolve(path)
            text = target.read_text(encoding="utf-8")
            found = text.count(old_text)
            if found == 0:
                return "Error: the text to replace was not found in the file"
            if found > 1:
                return f"Error: the text to replace was found {found} times, give more of the surrounding text"
            target.write_text(text.replace(old_text, new_text), encoding="utf-8")
            return f"File {path} was edited."
        except Exception as error:
            return f"Error: {error}"

    def move_file(self, source, destination):
        try:
            source_path = self._resolve(source)
            destination_path = self._resolve(destination)
            if not source_path.is_file():
                return f"Error: no such file: {source}"
            if destination_path.exists():
                return f"Error: the destination already exists: {destination}"
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            source_path.rename(destination_path)
            return f"File {source} was moved to {destination}."
        except Exception as error:
            return f"Error: {error}"

    def delete_file(self, path):
        try:
            target = self._resolve(path)
            if not target.is_file():
                return f"Error: no such file: {path}"
            target.unlink()
            return f"File {path} was deleted."
        except Exception as error:
            return f"Error: {error}"

    def run_command(self, command):
        if not self._limits.allows(command):
            allowed = ", ".join(self._limits.allowed_commands) or "none"
            return f"Error: the command is not on the allowlist: {command}. Allowed commands: {allowed}"
        try:
            done = subprocess.run(
                command.split(),
                cwd=self._root,
                capture_output=True,
                text=True,
                timeout=self._limits.timeout,
            )
            return f"exit code: {done.returncode}\n{done.stdout}{done.stderr}"
        except subprocess.TimeoutExpired:
            return f"Error: the command ran longer than the limit of {self._limits.timeout} seconds and was stopped"
        except Exception as error:
            return f"Error: {error}"