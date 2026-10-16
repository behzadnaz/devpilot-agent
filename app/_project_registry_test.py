from app.project_registry import ProjectRegistry


class _ProjectRegistryTest:
    def test_project_registry_keeps_each_project_configuration_separate(
        self, tmp_path
    ):
        planning_path = tmp_path / "planning"
        development_path = tmp_path / "development"
        planning_path.mkdir()
        development_path.mkdir()

        registry = ProjectRegistry({
            "planning": {
                "path": planning_path,
                "workflow": "planning",
            },
            "development": {
                "path": development_path,
                "workflow": "development",
            },
        })

        planning = registry.get_config("planning")
        development = registry.get_config("development")

        assert planning["path"] == planning_path
        assert planning["workflow"] == "planning"
        assert development["path"] == development_path
        assert development["workflow"] == "development"

    def test_unknown_project_raises_key_error(self, tmp_path):
        from app.project_registry import ProjectRegistry

        registry = ProjectRegistry({
            "planning": {
                "path": tmp_path / "planning",
                "workflow": "planning",
            },
        })

        try:
            registry.get_config("unknown-project")
            assert False, "Expected KeyError for unknown project"
        except KeyError as error:
            assert "unknown-project" in str(error)
