from app.limits import Limits


class _LimitsTest:
    def test_allowlist_and_timeout_are_read_from_limits_yaml(self, tmp_path):
        yaml_file = tmp_path / "limits.yaml"
        yaml_file.write_text("allowed_commands:\n  - pytest -q\n  - python --version\ntimeout: 30\n")

        limits = Limits.load(yaml_file)

        assert limits.allowed_commands == ("pytest -q", "python --version"), "allowlist"
        assert limits.timeout == 30, "timeout"

    def test_allows_only_the_listed_commands(self):
        limits = Limits(allowed_commands=("pytest -q",), timeout=30)

        assert limits.allows("pytest -q"), "a listed command"
        assert not limits.allows("pytest -q && del *"), "a listed command with something added"
        assert not limits.allows("rm -rf ."), "a command that is not listed"

    def test_value_object(self):
        limits = Limits(allowed_commands=("pytest -q",), timeout=30)

        assert limits == Limits(allowed_commands=("pytest -q",), timeout=30), "same values are equal"
        assert limits != Limits(allowed_commands=("pytest",), timeout=30), "different commands"
        assert limits != Limits(allowed_commands=("pytest -q",), timeout=31), "different timeout"
        assert hash(limits) == hash(Limits(allowed_commands=("pytest -q",), timeout=30)), "hash"
        assert repr(limits) == "Limits(allowed_commands=('pytest -q',), timeout=30)", "repr"
        assert limits != None, "not equal to None"  # noqa: E711