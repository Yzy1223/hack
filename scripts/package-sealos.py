"""Create a self-contained Docker build context with the catalog fields used by the UI."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
catalog = root.parent / "gushi"
if not catalog.is_dir():
    catalog = root / "catalog"
archive = root / "workbench-sealos.zip"
files = ["Dockerfile", ".dockerignore", "package.json", "package-lock.json",
         "backend/package.json", "backend/tsconfig.json", "frontend/package.json",
         "frontend/index.html", "frontend/vite.config.ts", "frontend/tsconfig.json",
         "docs/sealos.md", "backend/resources/fitments.json"]
if not catalog.is_dir():
    raise SystemExit(f"Missing catalog directory: {catalog}")
with ZipFile(archive, "w", ZIP_DEFLATED) as bundle:
    for name in files:
        bundle.write(root / name, name)
    for folder in ("backend/src", "frontend/src", "shared"):
        for file in sorted((root / folder).rglob("*")):
            if file.is_file() and file.suffix in {".css", ".ts", ".tsx"}:
                bundle.write(file, file.relative_to(root).as_posix())
    for file in sorted((root / "backend/resources/checked").glob("*.webp")):
        bundle.write(file, file.relative_to(root).as_posix())
    for file in sorted((root / "backend/test").glob("*.test.ts")):
        bundle.write(file, file.relative_to(root).as_posix())
    bundle.writestr("catalog/", "")
    count = 0
    for file in sorted(catalog.rglob("features.json")):
        relative = file.relative_to(catalog)
        if any(p.startswith(("_", ".")) for p in relative.parts):
            continue
        item = json.loads(file.read_text(encoding="utf-8-sig"))
        summary = {"model_label": item.get("model_label") or file.parent.name,
                   "features": item.get("features", {}),
                   "matching_policy": item.get("matching_policy", {}),
                   "analysis": {"human_reviewed": item.get("analysis", {}).get("human_reviewed") is True}}
        bundle.writestr("catalog/" + relative.as_posix(), json.dumps(summary, ensure_ascii=False))
        count += 1
print(f"{archive}: {count} catalog entries")

