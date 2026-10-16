from app.project_registry import ProjectRegistry
from app.tools import ToolSet


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

    def test_registry_builds_agent_from_requested_project_config(self):
        projects = {
            "alpha": {"root": "projects/alpha"},
            "beta": {"root": "projects/beta"},
        }

        def agent_factory(project_id, config):
            return {
                "project_id": project_id,
                "root": config["root"],
            }

        registry = ProjectRegistry(
            projects,
            agent_factory=agent_factory,
        )

        alpha_agent = registry.get_agent("alpha")
        beta_agent = registry.get_agent("beta")

        assert alpha_agent["project_id"] == "alpha"
        assert alpha_agent["root"] == "projects/alpha"
        assert beta_agent["project_id"] == "beta"
        assert beta_agent["root"] == "projects/beta"

    def test_agents_use_their_own_project_roots(self, tmp_path):
        planning_path = tmp_path / "planning"
        development_path = tmp_path / "development"
        planning_path.mkdir()
        development_path.mkdir()

        registry = ProjectRegistry(
            {
                "planning": {"path": planning_path},
                "development": {"path": development_path},
            },
            agent_factory=lambda project_id, config: ToolSet(
                project_folder=config["path"]
            ),
        )

        planning_tools = registry.get_agent("planning")
        development_tools = registry.get_agent("development")

        planning_tools.create_file("planning.txt", "Planning project")
        development_tools.create_file("development.txt", "Development project")

        assert (planning_path / "planning.txt").read_text() == "Planning project"
        assert not (development_path / "planning.txt").exists()

        assert (development_path / "development.txt").read_text() == "Development project"
        assert not (planning_path / "development.txt").exists()

    def test_registry_builds_agent_from_requested_project_config(self):
        projects = {
            "planning": {"path": "projects/planning"},
            "development": {"path": "projects/development"},
        }

        created_agents = []

        def agent_factory(project_id, config):
            agent = {
                "project_id": project_id,
                "path": config["path"],
            }
            created_agents.append(agent)
            return agent

        registry = ProjectRegistry(
            projects,
            agent_factory=agent_factory,
        )

        planning_agent = registry.get_agent("planning")
        development_agent = registry.get_agent("development")

        assert planning_agent["project_id"] == "planning"
        assert planning_agent["path"] == "projects/planning"
        assert development_agent["project_id"] == "development"
        assert development_agent["path"] == "projects/development"
        assert len(created_agents) == 2

