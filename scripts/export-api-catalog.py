"""Print the active FastAPI routes as a Markdown table."""
from app.main import app

print("| Method | Path | Handler |")
print("| --- | --- | --- |")
for route in sorted(app.routes, key=lambda item: (getattr(item, "path", ""), sorted(getattr(item, "methods", [])))):
    for method in sorted(getattr(route, "methods", set()) - {"HEAD", "OPTIONS"}):
        print(f"| {method} | `{route.path}` | `{route.endpoint.__module__}.{route.endpoint.__name__}` |")
