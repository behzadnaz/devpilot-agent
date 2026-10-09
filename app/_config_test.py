from app.config import ModelSettings


class _ModelSettingsTest:
    def test_model_name_and_endpoint_are_read_from_model_yaml(self, tmp_path):
        yaml_file = tmp_path / "model.yaml"
        yaml_file.write_text("model: some-other-model\nendpoint: http://example.test:1234\n")

        settings = ModelSettings.load(yaml_file)

        assert settings.model == "some-other-model", "model name"
        assert settings.endpoint == "http://example.test:1234", "endpoint"

    def test_context_size_is_read_from_model_yaml(self, tmp_path):
        yaml_file = tmp_path / "model.yaml"
        yaml_file.write_text("model: m\nendpoint: http://x\ncontext_size: 8192\n")

        settings = ModelSettings.load(yaml_file)

        assert settings.context_size == 8192, "context size"

    def test_value_object(self):
        settings = ModelSettings(model="a", endpoint="http://x")

        assert settings == ModelSettings(model="a", endpoint="http://x"), "same values are equal"
        assert settings != ModelSettings(model="b", endpoint="http://x"), "different model"
        assert settings != ModelSettings(model="a", endpoint="http://y"), "different endpoint"
        assert hash(settings) == hash(ModelSettings(model="a", endpoint="http://x")), "hash"
        assert repr(settings) == "ModelSettings(model='a', endpoint='http://x', context_size=4096)", "repr"
        assert settings != None, "not equal to None"  # noqa: E711