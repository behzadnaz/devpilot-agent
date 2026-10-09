from app._ollama_client_stub import _OllamaClientStub
from app.config import ModelSettings
from app.preflight import Preflight, PreflightResult

SETTINGS = ModelSettings(model="qwen3-4b-local", endpoint="http://localhost:11434")


class _PreflightTest:
    def test_unreachable_model_fails_the_task_with_a_message(self, tmp_path):
        preflight = Preflight(SETTINGS, _OllamaClientStub.unreachable(), tmp_path)

        result = preflight.check()

        assert result.status == "failed", "status"
        assert "cannot be reached" in result.message, "message says the model cannot be reached"
        assert SETTINGS.endpoint in result.message, "message names the endpoint"

    def test_unreachable_model_changes_no_file(self, tmp_path):
        (tmp_path / "hello.py").write_text("print('hello')\n")
        preflight = Preflight(SETTINGS, _OllamaClientStub.unreachable(), tmp_path)

        preflight.check()

        assert sorted(p.name for p in tmp_path.iterdir()) == ["hello.py"], "no file added or removed"
        assert (tmp_path / "hello.py").read_text() == "print('hello')\n", "content unchanged"

    def test_reachable_model_passes_the_check(self, tmp_path):
        preflight = Preflight(SETTINGS, _OllamaClientStub(), tmp_path)

        result = preflight.check()

        assert result.status == "ok", "status"

    def test_prompt_that_fits_the_context_window_passes(self, tmp_path):
        settings = ModelSettings(model="m", endpoint="http://x", context_size=1000)
        preflight = Preflight(settings, _OllamaClientStub(), tmp_path)

        result = preflight.check_context_window(system_prompt="a" * 400, tool_list="b" * 400)

        assert result.status == "ok", "status"

    def test_prompt_that_does_not_fit_fails_and_says_what_to_change(self, tmp_path):
        settings = ModelSettings(model="m", endpoint="http://x", context_size=1000)
        preflight = Preflight(settings, _OllamaClientStub(), tmp_path)

        result = preflight.check_context_window(system_prompt="a" * 4000, tool_list="b" * 4000)

        assert result.status == "failed", "status"
        assert "context_size" in result.message, "message names the setting"
        assert "config/model.yaml" in result.message, "message says where to change it"


class _PreflightResultTest:
    def test_value_object(self):
        result = PreflightResult(status="failed", message="m")

        assert result == PreflightResult(status="failed", message="m"), "same values are equal"
        assert result != PreflightResult(status="ok", message="m"), "different status"
        assert result != PreflightResult(status="failed", message="x"), "different message"
        assert hash(result) == hash(PreflightResult(status="failed", message="m")), "hash"
        assert repr(result) == "PreflightResult(status='failed', message='m')", "repr"
        assert result != None, "not equal to None"  # noqa: E711