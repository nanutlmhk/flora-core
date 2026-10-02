# Generic ASCII key/value

- Parser name in config: `ascii_kv`.
- Device types: `serial-temp-module`.
- Transport: Typically serial.

`parser.py` buffers lines, maps key/value pairs, and supports a configured poll command. Field mappings come from instance options.

## Configuration

Edit the matching pod in [gateway.toml](../../../../../../config/gateway.toml)
and device record in [instances.json](../../../../../../config/instances.json).
Model defaults are registered in Haber's catalog. See the
[configuration guide](../../../../../../CONFIGURATION.md) for loading these files and
[protocol details](../../../../../../CONFIGURATION.md) for options and supported scope.

## Tests and development

From `flora-gateway/python/device-medical-service`:

```powershell
python -m pytest -q tests/generic/ascii_kv
```

The tests mirror this folder; shared synthetic fixtures are in `tests/fixtures`.
Read [DEVELOPMENT.md](../../../../../../DEVELOPMENT.md) for the parser contract, data flow,
and registration checklist.
