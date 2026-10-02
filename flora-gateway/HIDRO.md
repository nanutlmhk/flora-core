# Hidro integration migration

The Node.js integrations in `C:\Users\JK\Hidro\service` have been rewritten as
Flora-Gateway parsers. Rust owns serial/TCP I/O and reconnects; Python owns device
framing, checksums, commands, and mappings; Kafka carries raw frames, commands,
and observations; the existing collector and data API handle storage and delivery.
Node.js is used only to regenerate test reference fixtures, not at runtime.

Follow [CONFIGURATION.md](CONFIGURATION.md) to edit connection settings, select
config files, register devices, and start the controllers.

## Source inventory and destination

| Hidro implementation | Flora device type | Parser / transport |
| --- | --- | --- |
| `ge750` | `ge-carestation-750` | `ge_carestation`, serial COM 1.2 |
| `geaisyscs2/ge750aisys.service.js`, the active Hidro Aisys backend | `ge-aisys-cs2` | `ge_carestation`, serial COM 1.2 |
| `gebx50` | `ge-bx50-dri` | `ge_dri`, serial, Hidro escaped-byte checksum profile |
| `ges5` | `ge-s5-dri` | `ge_dri`, serial, payload checksum profile |
| Legacy `geaisyscs2` DRI files | `ge-aisys-dri` | `ge_dri`, serial, payload checksum profile |
| `bbraunbcc` | `bbraun-space-bcc` | `bbraun_bcc`, outbound raw TCP |
| `gehl7`, `hl7Parser.js`, `obxMapper.js`, alias seeds in `db.js` | `hidro-hl7-monitor` | `hidro_hl7`, TCP MLLP with controller ACK |

Hidro's README also names Dräger IACS/Vista, Philips IntelliVue, and
Primus/Perseus/Atlan. This checkout does not contain separate native drivers for
those families. Its shared HL7 path can be configured for matching vendor feeds,
but the port does not claim native Philips or additional Dräger protocol support.
M540 and MEDIBUS from Vector remain available through [DRAEGER.md](DRAEGER.md).
The optional `vscaptureFile.service` referenced by Hidro's server is absent from
the supplied tree and has no source to port.

## Carestation 750 and Aisys COM 1.2

The parser initializes the read interface with `VTE`, `VTO12`, and `VTX`, one
command per timer tick, then reads autonomous VTd/VTq frames. It reinitializes
after a transport reconnect or `session_timeout_sec` without a valid response.
These commands select the communication format; they do not change therapy
settings. The settings frame reports current settings.

The port carries Hidro's 54 mapped measured/settings fields, including short
and extended frame layouts, mode characters, agent identity, I:E formatting,
mechanical-rate fallback, pressures, gas concentrations/flows, and timing.
`poll_interval_sec` defaults to 1, `session_timeout_sec` to 30, and
`max_frame_bytes` to 4096. `parameters` overrides individual mapping rules from
`parsers/ge/carestation/parameters.json`.

Differences from Hidro:

- A bad checksum is rejected instead of being treated as a checksum-free frame.
- CO2 percentage measurements use `fi_co2_pct` and `et_co2_pct`, with `%` units.
  They are not assigned to Flora's mmHg chart keys.
- Inspiratory pause maps to `set_insp_pause_pct`, matching Flora's chart key.
- Every valid measurement frame is emitted; there is no Hidro 20-second throttle.
- Unsupported/missing values remain absent, rather than being carried forward.

## GE DRI profiles

The shared decoder validates record lengths, escapes, checksums, subrecord bounds,
and the two unavailable-value sentinels used by Hidro. Only the basic PHDB class
is decoded; extension classes and waveform records are not mistaken for basic
data. The source also left extension classes undecoded.

| Option | Meaning / default |
| --- | --- |
| `checksum_mode` | `payload` for S/5 and legacy Aisys; `escaped` for Hidro's Bx50 variant |
| `dri_levels` | S/5 `[9,8,7]`; Bx50/legacy Aisys `[12,11,10,9,8,6]` |
| `transmission_interval_sec` | Requested display transmission interval, default 5, minimum 5 |
| `poll_interval_sec` | Resend the read subscription, default 15 seconds |
| `pressure_roles` | Explicit `P1`–`P4` assignment to `ART` or `CVP`; default none |
| `temperature_channel` | Canonical temperature source, default `T1` |
| `respiration_channel` | Canonical RR source, default `CO2_RR` |
| `tidal_volume_scale_ml` | Optional mL per raw integer, after confirming device scaling |

The checksum variants are deliberate source differences; the parser does not
silently guess which variant a packet uses. Requests preserve each source
profile's firmware-level list and wire format.

Channel-specific observations are retained. Canonical temperature and RR aliases
use the selected channels. ART/CVP aliases require explicit pressure roles.
CO2 uses Hidro's ambient-pressure calculation, then converts kPa to mmHg for
Flora's canonical chart keys. The DRI record timestamp is retained as `device_ts`.

**Tidal-volume scaling needs device confirmation.** Hidro multiplies the raw value
by 0.1, but labels the result as litres. The supplied S/5 interface PDF does not
provide the basic field definition needed to resolve that discrepancy. Until
`tidal_volume_scale_ml` is configured, the same scaled value is available as
`dri_tidal_volume_insp` / `dri_tidal_volume_exp`, without an asserted unit. It is
not emitted into the chart's mL tidal-volume fields. When configured, the option
applies to the original signed integer, e.g. `0.1` means raw 4500 becomes 450 mL.

Hidro's value-only NIBP deduplication is not carried over: equal consecutive cuff
values may be distinct measurements. The gateway does not infer a new cuff cycle
from a numeric change alone. NIBP status and label values remain available.

## B. Braun BCC

The socket controller connects to `remote_host:port` and forwards unmodified
binary chunks. The parser handles SOH/EOT framing, BCC character escaping,
declared length, checksum, `ADMIN:ALIVE`, `MEM:GET`, and ACK replies. Reconnects
reset partial-frame and polling state. Incoming checksummed frames are acknowledged;
only the configured bed and pump address produce observations.

All 26 fields mapped by Hidro are retained: identity, infusion/dose/bolus rates,
volumes, drug information, pump state/alarms, and patient attributes. The original
relative-time field is not treated as an absolute device timestamp; `device_ts`
stays null and `system_ts` uses gateway acquisition time. Drug concentration and
dose-rate unit records are paired within the same response when available.

`address` is required, `bed_id` defaults to `1/1/1`, `poll_interval_sec` to 5,
`session_timeout_sec` to 15, and `max_frame_bytes` to 262144. Use one instance and
TCP pod per selected pump address. `parameters` can override individual rules
from `parsers/bbraun/bcc/parameters.json`. No drug delivery commands are issued.

## Shared HL7 path

The profile adds Hidro's 45 numeric/text aliases, including invasive pulse,
CVP, NIBP, and ST channels, to Flora's existing HL7 parser. Alias units are used
only when OBX supplies none. Zero is preserved as a valid numeric observation.
Optional `repair_segments = true` enables Hidro's legacy missing-CR repair;
leave it false for normal HL7. `codes` adds site/vendor-specific aliases and
`source_ip` selects the intended monitor. Confirm codes and units against the
device's configured HL7 output.

## Storage versus chart display

All mapped fields travel through `gw.obs` into the gateway's observation store
and data API. Fields already recognized by Flora's clinical chart retain their
canonical keys. Extended GE fields, channel-specific measurements, CO2 percentage,
ST values, and BCC fields can be queried from the gateway but may need a separate
chart/UI mapping before they are displayed downstream. No infusion UI was added
as part of the driver port.

## Validation and provenance

Tests use synthetic records, not Hidro's raw captures or patient databases.
`tests/fixtures/hidro_reference.json` contains expected values and command bytes
generated by the original Node.js protocol modules. To regenerate it when the
source tree is available, from `python/device-medical-service`:

```powershell
node tests/generate_hidro_fixtures.cjs C:/Users/JK/Hidro
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

Tests cover source parity, every split position in representative GE/BCC frames,
corruption, buffering, code-page boundaries, unit mapping, pump/monitor isolation,
initialization, and reconnect reset. Rust tests cover configuration, binary TCP
exchange over loopback, raw framing, and existing HL7 behavior. The rewritten
drivers have not yet been tested against physical devices.

Hidro's MIT license and source attribution are included in
[THIRD_PARTY_NOTICES.md](python/device-medical-service/THIRD_PARTY_NOTICES.md).
