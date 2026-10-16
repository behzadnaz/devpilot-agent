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