import pytest

from app.limits import Limits
from app.tools import ToolSet


def _new_tools(tmp_path, **options):
    project = tmp_path / "project"
    project.mkdir()
    (tmp_path / "secrets.txt").write_text("top secret")
    return ToolSet(project, **options)


class _ToolSetTest:
    def test_path_outside_the_project_is_refused_by_every_tool(self, tmp_path):
        tools = _new_tools(tmp_path)

        # Add every new tool that takes a path to this test, one line each.
        assert "outside the project" in tools.read_file("../secrets.txt"), "read_file"
        assert "outside the project" in tools.list_files(".."), "list_files"
        assert "outside the project" in tools.create_file("../evil.txt", "x"), "create_file"
        assert "outside the project" in tools.edit_file("../secrets.txt", "top", "x"), "edit_file"
        assert "outside the project" in tools.move_file("../secrets.txt", "moved.txt"), "move_file, source"
        assert "outside the project" in tools.move_file("moved.txt", "../moved.txt"), "move_file, destination"
        assert "outside the project" in tools.delete_file("../secrets.txt"), "delete_file"

    def test_refused_call_reads_and_writes_nothing(self, tmp_path):
        tools = _new_tools(tmp_path)

        result = tools.read_file("../secrets.txt")
        tools.create_file("../evil.txt", "x")
        tools.edit_file("../secrets.txt", "top", "changed")
        tools.delete_file("../secrets.txt")

        assert "top secret" not in result, "the secret is not returned"
        assert sorted(p.name for p in tmp_path.iterdir()) == ["project", "secrets.txt"], "no file added or removed"
        assert (tmp_path / "secrets.txt").read_text() == "top secret", "content unchanged"

    def test_absolute_path_is_refused(self, tmp_path):
        tools = _new_tools(tmp_path)
        (tmp_path / "project" / "inside.txt").write_text("hello")

        outside = tools.read_file(str(tmp_path / "secrets.txt"))
        inside = tools.read_file(str(tmp_path / "project" / "inside.txt"))

        assert "relative" in outside, "absolute path to a file outside"
        assert "relative" in inside, "absolute path to a file inside"

    def test_symlink_that_leaves_the_project_is_refused(self, tmp_path):
        tools = _new_tools(tmp_path)
        link = tmp_path / "project" / "link.txt"
        try:
            link.symlink_to(tmp_path / "secrets.txt")
        except OSError:
            pytest.skip("this computer does not allow symlinks (Windows: turn on Developer Mode)")

        result = tools.read_file("link.txt")

        assert "outside the project" in result, "refused"
        assert "top secret" not in result, "the secret is not returned"

    def test_list_files_returns_the_entries(self, tmp_path):
        tools = _new_tools(tmp_path)
        project = tmp_path / "project"
        (project / "docs").mkdir()
        (project / "calculator.py").write_text("x")
        (project / "README.md").write_text("y")

        result = tools.list_files()

        assert result == "docs/\ncalculator.py\nREADME.md", "folders first, then files, folders end with a slash"

    def test_read_file_returns_the_content(self, tmp_path):
        tools = _new_tools(tmp_path)
        (tmp_path / "project" / "hello.py").write_text("print('hello')\n")

        result = tools.read_file("hello.py")

        assert result == "print('hello')\n", "content"

    def test_file_longer_than_the_read_limit_is_returned_in_parts(self, tmp_path):
        tools = _new_tools(tmp_path, read_limit=10)
        (tmp_path / "project" / "big.txt").write_text("0123456789ABCDEFGHIJ")

        first = tools.read_file("big.txt")
        second = tools.read_file("big.txt", start=10)

        assert first.startswith("0123456789"), "first part"
        assert "more follows" in first, "the first part says that more follows"
        assert "start=10" in first, "the first part says where the next part starts"
        assert second == "ABCDEFGHIJ", "last part, with no note"

    def test_create_file(self, tmp_path):
        tools = _new_tools(tmp_path)
        project = tmp_path / "project"

        result = tools.create_file("calculator.py", "def add(a, b):\n    return a + b\n")
        tools.create_file("docs/notes.md", "hello")

        assert result == "File calculator.py was created.", "reply"
        assert (project / "calculator.py").read_text() == "def add(a, b):\n    return a + b\n", "content"
        assert (project / "docs" / "notes.md").read_text() == "hello", "a missing folder is created"

    def test_edit_file(self, tmp_path):
        tools = _new_tools(tmp_path)
        (tmp_path / "project" / "calculator.py").write_text("def add(a, b):\n    return a - b\n")

        result = tools.edit_file("calculator.py", "a - b", "a + b")

        assert result == "File calculator.py was edited.", "reply"
        assert (tmp_path / "project" / "calculator.py").read_text() == "def add(a, b):\n    return a + b\n", "content"

    def test_edit_file_refuses_text_that_does_not_match_exactly_once(self, tmp_path):
        tools = _new_tools(tmp_path)
        original = "x = 1\nx = 1\n"
        (tmp_path / "project" / "values.py").write_text(original)

        missing = tools.edit_file("values.py", "y = 2", "y = 3")
        twice = tools.edit_file("values.py", "x = 1", "x = 2")

        assert "not found" in missing, "text that is not in the file"
        assert "2 times" in twice, "text that is in the file twice"
        assert (tmp_path / "project" / "values.py").read_text() == original, "file unchanged"

    def test_move_file(self, tmp_path):
        tools = _new_tools(tmp_path)
        project = tmp_path / "project"
        (project / "utils.py").write_text("code")
        (project / "taken.py").write_text("other")

        result = tools.move_file("utils.py", "lib/session.py")
        blocked = tools.move_file("lib/session.py", "taken.py")

        assert result == "File utils.py was moved to lib/session.py.", "reply"
        assert not (project / "utils.py").exists(), "the old file is gone"
        assert (project / "lib" / "session.py").read_text() == "code", "the new file has the content"
        assert "already exists" in blocked, "an existing destination is refused"
        assert (project / "taken.py").read_text() == "other", "the existing file is not overwritten"

    def test_delete_file(self, tmp_path):
        tools = _new_tools(tmp_path)
        project = tmp_path / "project"
        (project / "old.py").write_text("code")
        (project / "docs").mkdir()

        result = tools.delete_file("old.py")
        missing = tools.delete_file("nothing.py")
        tools.delete_file("docs")

        assert result == "File old.py was deleted.", "reply"
        assert not (project / "old.py").exists(), "the file is gone"
        assert "no such file" in missing, "a missing file"
        assert (project / "docs").is_dir(), "a folder is not deleted"

    def test_allowed_command_returns_output_and_exit_code(self, tmp_path):
        limits = Limits(allowed_commands=("python --version", "python no_such_file.py"), timeout=30)
        tools = _new_tools(tmp_path, limits=limits)

        worked = tools.run_command("python --version")
        failed = tools.run_command("python no_such_file.py")

        assert "exit code: 0" in worked, "exit code of a command that works"
        assert "Python" in worked, "output of a command that works"
        assert "exit code: 2" in failed, "exit code of a command that fails"

    def test_command_runs_inside_the_project_folder(self, tmp_path):
        limits = Limits(allowed_commands=("python where.py",), timeout=30)
        tools = _new_tools(tmp_path, limits=limits)
        (tmp_path / "project" / "where.py").write_text("import os\nprint(os.getcwd())\n")

        result = tools.run_command("python where.py")

        assert str((tmp_path / "project").resolve()) in result, "the working folder is the project"

    def test_command_not_on_the_allowlist_is_refused_with_a_reason(self, tmp_path):
        limits = Limits(allowed_commands=("python --version",), timeout=30)
        tools = _new_tools(tmp_path, limits=limits)

        result = tools.run_command("python --help")

        assert "not on the allowlist" in result, "the reason"
        assert "python --version" in result, "the allowed commands are listed"
        assert "usage" not in result.lower(), "the command was not run"

    def test_command_past_the_timeout_is_stopped_with_a_reason(self, tmp_path):
        limits = Limits(allowed_commands=("python slow.py",), timeout=1)
        tools = _new_tools(tmp_path, limits=limits)
        (tmp_path / "project" / "slow.py").write_text("import time\ntime.sleep(3)\n")

        result = tools.run_command("python slow.py")

        assert "longer than" in result, "the reason"
        assert "stopped" in result, "it was stopped"