
import json
from pathlib import Path


class ProjectRegistry:
    """Stores project configurations and creates their agents."""

    def __init__(
        self,
        projects,
        agent_factory=None,
        persistence_path=None,
    ):
        self._agent_factory = agent_factory
        self._persistence_path = (
            Path(persistence_path).expanduser()
            if persistence_path is not None
            else None
        )

        self._projects = {
            project_id: dict(config)
            for project_id, config in projects.items()
        }

        # Saved state is authoritative so deleted projects
        # are not accidentally restored from startup defaults.
        if self._persistence_path is not None:
            if self._persistence_path.exists():
                saved_projects = json.loads(
                    self._persistence_path.read_text(encoding="utf-8")
                )

                if not isinstance(saved_projects, dict):
                    raise ValueError(
                        "Saved project registry must contain a JSON object."
                    )

                self._projects = {
                    project_id: dict(config)
                    for project_id, config in saved_projects.items()
                }

    def _save(self):
        """Persist project configurations when storage is enabled."""
        if self._persistence_path is None:
            return

        self._persistence_path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        serializable_projects = {
            project_id: {
                key: str(value) if isinstance(value, Path) else value
                for key, value in config.items()
            }
            for project_id, config in self._projects.items()
        }

        temporary_path = self._persistence_path.with_suffix(
            self._persistence_path.suffix + ".tmp"
        )

        temporary_path.write_text(
            json.dumps(
                serializable_projects,
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        temporary_path.replace(self._persistence_path)

    def get_config(self, project_id):
        """Return the configuration for one project."""
        try:
            return self._projects[project_id]
        except KeyError:
            raise KeyError(f"Unknown project: {project_id}") from None

    def get_agent(self, project_id):
        """Create an agent using the requested project's configuration."""
        if self._agent_factory is None:
            raise RuntimeError("No agent factory configured.")

        config = self.get_config(project_id)
        return self._agent_factory(project_id, config)

    def add_project(self, project_id, config):
        """Register and persist a project without replacing an existing one."""
        if project_id in self._projects:
            raise ValueError(f"Project already exists: {project_id}")

        self._projects[project_id] = dict(config)

        try:
            self._save()
        except Exception:
            self._projects.pop(project_id, None)
            raise

    def list_projects(self):
        """Return the registered project configurations."""
        return {
            project_id: dict(config)
            for project_id, config in self._projects.items()
        }

    def remove_project(self, project_id):
        """Remove and persist a project configuration."""
        try:
            config = self._projects.pop(project_id)
        except KeyError:
            raise KeyError(f"Unknown project: {project_id}") from None

        try:
            self._save()
        except Exception:
            self._projects[project_id] = config
            raise

        return config
