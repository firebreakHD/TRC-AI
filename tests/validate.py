import json
from pathlib import Path
import re

from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate
import yaml

root = Path(__file__).resolve().parents[1]
for pattern, parser in [("*.yaml", yaml.safe_load), ("*.yml", yaml.safe_load), ("*.json", json.loads)]:
    for path in root.rglob(pattern):
        if not any(part.startswith(".") and part != ".github" for part in path.relative_to(root).parts):
            parser(path.read_text())

config = yaml.safe_load((root / "trc_ai/config.yaml").read_text())
repo = yaml.safe_load((root / "repository.yaml").read_text())
contract = yaml.safe_load((root / "contracts/openapi.yaml").read_text())
app = (root / "trc_ai/trc/app.py").read_text()
dockerfile = (root / "trc_ai/Dockerfile").read_text()
version = config["version"]
assert version == contract["info"]["version"] == re.search(r'^VERSION = "(.*)"$', app, re.M)[1]
assert f'org.opencontainers.image.version="{version}"' in dockerfile
assert repo["url"] == config["url"]
assert config["arch"] == ["amd64"]
assert config["backup"] == "cold"
assert config["ports"] == {f'{config["ingress_port"]}/tcp': None}

validate(contract)
schema = {"$ref": "#/components/schemas/Batch", "components": contract["components"]}
draft = Draft202012Validator(schema, format_checker=FormatChecker())
draft.validate(json.loads((root / "contracts/examples/tasks.json").read_text()))
print(f"YAML, JSON, OpenAPI, Vertragsbeispiel und Versionskonsistenz geprüft ({version}).")
