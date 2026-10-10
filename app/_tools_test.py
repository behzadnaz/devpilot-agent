import pytest

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

    def test_refused_call_reads_and_writes_nothing(self, tmp_path):
        tools = _new_tools(tmp_path)

        result = tools.read_file("../secrets.txt")

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