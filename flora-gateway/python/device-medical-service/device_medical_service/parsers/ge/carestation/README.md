# GE COM 1.2 / Carestation and Aisys

- Parser name in config: `ge_carestation`.
- Device types: `ge-carestation-750`, `ge-aisys-cs2`.
- Transport: Serial RS-232.

`parser.py` handles VTd/VTq frames and initialization. `parameters.json` maps measured values and reported settings. Carestation 750 and the active Hidro Aisys profile share this protocol.

## Configuration

Edit the matching pod in [gateway.hidro.toml](../../../../../../config/gateway.hidro.toml)
and device record in [instances.hidro.json](../../../../../../config/instances.hidro.json).
Model defaults are registered in Haber's catalog. See the
[configuration guide](../../../../../../CONFIGURATION.md) for loading these files and
[protocol details](../../../../../../HIDRO.md) for options and supported scope.

## Tests and development

From `flora-gateway/python/device-medical-service`:

```powershell
python -m pytest -q tests/ge/carestation
```

The tests mirror this folder; shared synthetic fixtures are in `tests/fixtures`.
Read [DEVELOPMENT.md](../../../../../../DEVELOPMENT.md) for the parser contract, data flow,
and registration checklist.
