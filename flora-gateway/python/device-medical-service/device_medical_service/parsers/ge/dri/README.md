# GE DRI / S/5, Bx50 and legacy Aisys

- Parser name in config: `ge_dri`.
- Device types: `ge-bx50-dri`, `ge-s5-dri`, `ge-aisys-dri`.
- Transport: Serial RS-232.

`parser.py` contains framing, display requests, basic PHDB offsets, and conversions. Model-specific checksum modes and firmware levels come from catalog defaults/options. Read the tidal-volume scaling limitation before configuring canonical volume output.

## Configuration

Edit the matching pod in [gateway.hidro.toml](../../../../../../config/gateway.hidro.toml)
and device record in [instances.hidro.json](../../../../../../config/instances.hidro.json).
Model defaults are registered in Haber's catalog. See the
[configuration guide](../../../../../../CONFIGURATION.md) for loading these files and
[protocol details](../../../../../../HIDRO.md) for options and supported scope.

## Tests and development

From `flora-gateway/python/device-medical-service`:

```powershell
python -m pytest -q tests/ge/dri
```

The tests mirror this folder; shared synthetic fixtures are in `tests/fixtures`.
Read [DEVELOPMENT.md](../../../../../../DEVELOPMENT.md) for the parser contract, data flow,
and registration checklist.
