# Generic JSON fields

- Parser name in config: `json_fields`.
- Device types: `json-anesthesia-machine`, `http-ventilator`.
- Transport: HTTP feeder/webhook raw frames.

`parser.py` maps JSON values or observation lists. Field mappings come from instance options.

## Configuration

Edit the matching pod in [gateway.toml](../../../../../../config/gateway.toml)
and device record in [instances.json](../../../../../../config/instances.json).
Model defaults are registered in Haber's catalog. See the
[configuration guide](../../../../../../CONFIGURATION.md) for loading these files and
[protocol details](../../../../../../CONFIGURATION.md) for options and supported scope.

## Tests and development

From `flora-gateway/python/device-medical-service`:

```powershell
python -m pytest -q tests/generic/json_fields
```

The tests mirror this folder; shared synthetic fixtures are in `tests/fixtures`.
Read [DEVELOPMENT.md](../../../../../../DEVELOPMENT.md) for the parser contract, data flow,
and registration checklist.
