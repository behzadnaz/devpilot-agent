from pathlib import Path

SANDBOX = (Path(__file__).resolve().parent.parent / "sandbox").resolve()


def _safe_path(relative_path: str) -> Path:
    """Resolve a path and refuse anything outside the sandbox folder."""
    path = (SANDBOX / relative_path).resolve()
    if not path.is_relative_to(SANDBOX):
        raise ValueError("Access denied: path is outside the sandbox")
    return path


def list_files() -> str:
    """List all files inside the sandbox folder."""
    files = [p.relative_to(SANDBOX).as_posix() for p in SANDBOX.rglob("*") if p.is_file()]
    return "\n".join(files) if files else "The sandbox is empty."


def read_file(path: str) -> str:
    """Read a text file from the sandbox folder.

    Args:
        path: File path relative to the sandbox folder, for example calculator.py
    """
    try:
        return _safe_path(path).read_text(encoding="utf-8")
    except Exception as e:
        return f"Error: {e}"


TOOLS = {"list_files": list_files, "read_file": read_file}