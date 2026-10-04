import difflib
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HIDDEN = {".venv", ".git", ".idea", "__pycache__", ".pytest_cache"}
READ_ONLY = {"agent"}  # the agent may read its own code but never change it
MAX_READ = 20000


def _resolve(relative_path: str, for_write: bool = False) -> Path:
    """Resolve a path inside the project and refuse anything protected."""
    path = (ROOT / relative_path).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError("Access denied: path is outside the project")
    parts = path.relative_to(ROOT).parts
    if any(p in HIDDEN or p.startswith(".env") for p in parts):
        raise ValueError("Access denied: protected path")
    if for_write and parts and parts[0] in READ_ONLY:
        raise ValueError("Access denied: the agent cannot change its own code")
    return path


def _confirm(question: str) -> bool:
    return input(f"{question} (y/n): ").strip().lower() == "y"


def project_tree() -> str:
    """Show the folder and file structure of the whole project (names only)."""
    lines = []

    def walk(folder: Path, prefix: str = "") -> None:
        entries = sorted(
            (p for p in folder.iterdir() if p.name not in HIDDEN and not p.name.startswith(".env")),
            key=lambda p: (p.is_file(), p.name.lower()),
        )
        for i, p in enumerate(entries):
            last = i == len(entries) - 1
            lines.append(f"{prefix}{'└── ' if last else '├── '}{p.name}{'/' if p.is_dir() else ''}")
            if p.is_dir():
                walk(p, prefix + ("    " if last else "│   "))

    walk(ROOT)
    return "\n".join(lines)


def read_file(path: str) -> str:
    """Read a text file in the project.

    Args:
        path: File path relative to the project root, for example sandbox/hello.py or README.md
    """
    try:
        text = _resolve(path).read_text(encoding="utf-8")
        return text[:MAX_READ] + ("\n...[truncated]" if len(text) > MAX_READ else "")
    except Exception as e:
        return f"Error: {e}"


def write_file(path: str, content: str) -> str:
    """Create or replace a file in the project. A human must approve it before it is written.

    Args:
        path: File path relative to the project root, for example docs/notes.md
        content: The complete new content of the file
    """
    try:
        target = _resolve(path, for_write=True)
        old = target.read_text(encoding="utf-8") if target.exists() else ""
        diff = difflib.unified_diff(
            old.splitlines(), content.splitlines(),
            fromfile=f"{path} (current)", tofile=f"{path} (proposed)", lineterm="",
        )
        print("\n--- Proposed change ---")
        print("\n".join(diff) or "(no changes)")
        if not _confirm("Apply this change?"):
            return "Change rejected by the human. Nothing was modified."
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"File {path} was written."
    except Exception as e:
        return f"Error: {e}"


def move_file(source: str, destination: str) -> str:
    """Move or rename a file. A human must approve it first.

    Args:
        source: Current path relative to the project root
        destination: New path relative to the project root
    """
    try:
        src = _resolve(source, for_write=True)
        dst = _resolve(destination, for_write=True)
        if not src.is_file():
            return "Error: the source file does not exist"
        if dst.exists():
            return "Error: the destination already exists"
        print(f"\n--- Proposed move ---\n{source}  ->  {destination}")
        if not _confirm("Apply this move?"):
            return "Move rejected by the human. Nothing was modified."
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        return f"Moved {source} to {destination}."
    except Exception as e:
        return f"Error: {e}"


def delete_file(path: str) -> str:
    """Delete one file. A human must approve it first.

    Args:
        path: File path relative to the project root
    """
    try:
        target = _resolve(path, for_write=True)
        if not target.is_file():
            return "Error: this is not an existing file"
        print(f"\n--- Proposed deletion ---\n{path}")
        if not _confirm("Delete this file?"):
            return "Deletion rejected by the human. Nothing was modified."
        target.unlink()
        return f"Deleted {path}."
    except Exception as e:
        return f"Error: {e}"


TOOLS = {
    "project_tree": project_tree,
    "read_file": read_file,
    "write_file": write_file,
    "move_file": move_file,
    "delete_file": delete_file,
}