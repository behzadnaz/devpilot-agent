import pytest

from app.tools import ToolSet


def _new_tools(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    (tmp_path / "secrets.txt").write_text("top secret")
    return ToolSet(project)


class _ToolSetTest:
    def test_path_outside_the_project_is_refused_by_every_tool(self, tmp_path):
        tools = _new_tools(tmp_path)

        # Add every new tool that takes a path to this test, one line each.
        assert "outside the project" in tools.read_file("../secrets.txt"), "read_file"

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