
class ProjectRegistry:
    """Stores each project's configuration separately."""

    def __init__(self, projects):
        self._projects = dict(projects)

    def get_config(self, project_id):
        """Return the configuration for one project."""
        try:
            return self._projects[project_id]
        except KeyError:
            raise KeyError(f"Unknown project: {project_id}") from None
