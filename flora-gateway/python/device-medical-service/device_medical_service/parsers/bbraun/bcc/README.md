# B. Braun Space / BCC

- Parser name in config: `bbraun_bcc`.
- Device types: `bbraun-space-bcc`.
- Transport: Outbound raw TCP.

`parser.py` handles BCC framing, polling, acknowledgements, and bed/pump selection. `parameters.json` holds observations. Use one TCP pod and instance per pump address.

## Configuration

Edit the matching pod in [gateway.hidro.toml](../../../../../../config/gateway.hidro.toml)
and device record in [instances.hidro.json](../../../../../../config/instances.hidro.json).
Model defaults are registered in Haber's catalog. See the
[configuration guide](../../../../../../CONFIGURATION.md) for loading these files and
[protocol details](../../../../../../HIDRO.md) for options and supported scope.

## Tests and development

From `flora-gateway/python/device-medical-service`:

```powershell
python -m pytest -q tests/bbraun/bcc
```

The tests mirror this folder; shared synthetic fixtures are in `tests/fixtures`.
Read [DEVELOPMENT.md](../../../../../../DEVELOPMENT.md) for the parser contract, data flow,
and registration checklist.
