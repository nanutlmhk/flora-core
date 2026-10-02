# Shared HL7 v2

- Parser name in config: `hl7v2`, `hidro_hl7`.
- Device types: `hl7-patient-monitor`, `hidro-hl7-monitor`.
- Transport: TCP MLLP with controller-generated ACK.

`parser.py` decodes shared HL7 messages. `hidro.py` adds Hidro aliases and optional missing-segment-separator repair; `parameters.json` holds those aliases. The generic `hl7v2` profile also has examples in the demo configs.

## Configuration

Edit the matching pod in [gateway.hidro.toml](../../../../../config/gateway.hidro.toml)
and device record in [instances.hidro.json](../../../../../config/instances.hidro.json).
Model defaults are registered in Haber's catalog. See the
[configuration guide](../../../../../CONFIGURATION.md) for loading these files and
[protocol details](../../../../../HIDRO.md) for options and supported scope.

## Tests and development

From `flora-gateway/python/device-medical-service`:

```powershell
python -m pytest -q tests/hl7
```

The tests mirror this folder; shared synthetic fixtures are in `tests/fixtures`.
Read [DEVELOPMENT.md](../../../../../DEVELOPMENT.md) for the parser contract, data flow,
and registration checklist.
