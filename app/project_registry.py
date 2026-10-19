class ProjectRegistry:
    """Stores each project's configuration and creates its agent."""

    def __init__(self, projects, agent_factory=None):
        self._projects = dict(projects)
        self._agent_factory = agent_factory

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
        """Register a new project without replacing an existing one."""
        if project_id in self._projects:
            raise ValueError(f"Project already exists: {project_id}")

        self._projects[project_id] = dict(config)

    def list_projects(self):
        """Return the registered project configurations."""
        return {
            project_id: dict(config)
            for project_id, config in self._projects.items()
        }

    def remove_project(self, project_id):
        """Remove a project from the registry."""
        try:
            return self._projects.pop(project_id)
        except KeyError:
            raise KeyError(f"Unknown project: {project_id}") from None

