#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ADAPTIVEOPS_REPO_ROOT="$REPO_ROOT"

python3 - <<'PY'
import os
import re
from pathlib import Path

root = Path(os.environ["ADAPTIVEOPS_REPO_ROOT"])
preview_id = os.environ.get("CLOUDFLARE_PREVIEW_D1_ID", "")
uuid = re.compile(r"^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")
if not uuid.fullmatch(preview_id):
    raise SystemExit("CLOUDFLARE_PREVIEW_D1_ID must be a D1 UUID.")

source = root / "control-plane" / "wrangler.toml"
output = root / "control-plane" / "wrangler.preview.generated.toml"
config = source.read_text()
production_block = re.search(
    r"\[\[env\.production\.d1_databases\]\](.*?)(?=\n\[|\Z)", config, re.S
)
production_id = re.search(r'^database_id\s*=\s*"([^"]+)"', production_block.group(1), re.M) if production_block else None
if not production_id:
    raise SystemExit("Could not verify the production D1 binding; refusing preview config generation.")
if preview_id.lower() == production_id.group(1).lower():
    raise SystemExit("Preview D1 ID must be different from the production D1 ID.")

if config.count("__PREVIEW_D1_DATABASE_ID__") != 1:
    raise SystemExit("Expected exactly one preview D1 placeholder in Wrangler config.")
output.write_text(config.replace("__PREVIEW_D1_DATABASE_ID__", preview_id))
output.chmod(0o600)
print("Rendered isolated Cloudflare preview config; database identifier was not printed.")
PY
