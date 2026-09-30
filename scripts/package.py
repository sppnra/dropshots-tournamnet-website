"""Package the complete source repository, excluding dependencies and private files."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys

root = Path(__file__).resolve().parents[1]
output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root.parent / "Dropshot-Folks-Netlify-Complete.zip"
required = [
    "index.html", "register.html", "app.js", "register.js", "registration-admin.js",
    "api.js", "config.js", "identity-client.js", "styles.css", "package.json",
    "package-lock.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "netlify.toml",
    ".gitignore", "README.md", "ARCHITECTURE.md",
]
folders = ["scripts", "netlify", "server", "tests"]
files = [root / name for name in required]
for folder in folders:
    files.extend(p for p in (root / folder).rglob("*") if p.is_file() and "__pycache__" not in p.parts)
for file in files:
    if not file.is_file():
        raise SystemExit(f"Required file is missing: {file}")
with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted(set(files)):
        archive.write(file, file.relative_to(root).as_posix())
with ZipFile(output) as archive:
    if archive.testzip():
        raise SystemExit("ZIP integrity check failed")
    names = set(archive.namelist())
    for name in required:
        if name not in names:
            raise SystemExit(f"ZIP is missing {name}")
    for prefix in ["scripts/", "netlify/functions/", "netlify/database/migrations/", "tests/", "server/"]:
        if not any(name.startswith(prefix) for name in names):
            raise SystemExit(f"ZIP is missing folder {prefix}")
    print(f"Verified complete source ZIP: {output}\n{len(names)} files; {output.stat().st_size:,} bytes")
