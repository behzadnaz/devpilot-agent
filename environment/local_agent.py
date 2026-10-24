from fastapi import FastAPI, HTTPException

from environment.checker import EnvironmentChecker


def create_local_agent(checker=None):
    app = FastAPI(title="DevPilot Local Environment Agent")
    environment_checker = checker or EnvironmentChecker()

    @app.post("/environment/check")
    def check_environment(request: dict):
        requirements = request.get("requirements")

        if not isinstance(requirements, list):
            raise HTTPException(
                status_code=422,
                detail="'requirements' must be a list.",
            )

        for item in requirements:
            if (
                not isinstance(item, dict)
                or not isinstance(item.get("name"), str)
                or not item["name"].strip()
            ):
                raise HTTPException(
                    status_code=422,
                    detail="Each requirement must include a technology name.",
                )

        try:
            results = environment_checker.check(requirements)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail="Environment check failed.",
            ) from exc

        return {"results": results}

    return app


app = create_local_agent()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "environment.local_agent:app",
        host="127.0.0.1",
        port=8765,
    )