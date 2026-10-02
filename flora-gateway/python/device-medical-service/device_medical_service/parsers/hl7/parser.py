"""HL7 v2 ORU^R01 (IHE PCD-01 style) observations from patient monitors."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from device_medical_service.envelope import RawFrame
from device_medical_service.parsers.shared.base import Parser, number

# ISO/IEEE 11073 MDC codes commonly sent in OBX-3. Verify against each device's
# HL7 conformance statement and extend through the device type's `codes` option.
MDC_CODES = {
    "147842": "hr",          # MDC_ECG_HEART_RATE
    "149530": "pr",          # MDC_PULS_OXIM_PULS_RATE
    "150456": "spo2",        # MDC_PULS_OXIM_SAT_O2
    "150033": "art_sys",     # MDC_PRESS_BLD_ART_SYS
    "150034": "art_dia",     # MDC_PRESS_BLD_ART_DIA
    "150035": "art_map",     # MDC_PRESS_BLD_ART_MEAN
    "150301": "nibp_sys",    # MDC_PRESS_CUFF_SYS
    "150302": "nibp_dia",    # MDC_PRESS_CUFF_DIA
    "150303": "nibp_map",    # MDC_PRESS_CUFF_MEAN
    "151562": "rr",          # MDC_RESP_RATE
    "150344": "temperature", # MDC_TEMP
    "151708": "et_co2",      # MDC_AWAY_CO2_ET
}


class Hl7v2Parser(Parser):
    name = "hl7v2"
    protocol = "hl7v2"
    default_codes = MDC_CODES

    def __init__(self, device_id: str, pod: str, options: dict[str, Any] | None = None):
        super().__init__(device_id, pod, options)
        self.zone = ZoneInfo(self.options.get("timezone", "Asia/Bangkok"))

    def feed(self, frame: RawFrame) -> list[dict[str, Any]]:
        text = frame.text.strip("\x0b\x1c\r\n")
        segments = [segment for segment in text.replace("\n", "\r").split("\r") if segment]
        if not segments or not segments[0].startswith("MSH"):
            return []
        field_sep = segments[0][3]
        component_sep = segments[0][4] if len(segments[0]) > 4 else "^"
        message_ts = None
        msh = segments[0].split(field_sep)
        if len(msh) > 6:
            message_ts = self.parse_ts(msh[6])
        observed_ts = message_ts
        rows: list[dict[str, Any]] = []
        for segment in segments[1:]:
            fields = segment.split(field_sep)
            if fields[0] == "OBR" and len(fields) > 7:
                observed_ts = self.parse_ts(fields[7]) or observed_ts
            if fields[0] != "OBX" or len(fields) < 6:
                continue
            identifier = fields[3].split(component_sep)
            code = identifier[0] if identifier else ""
            label = identifier[1] if len(identifier) > 1 else ""
            param = self.map_code(code, label)
            if not param:
                continue
            value_type = fields[2]
            raw_value = fields[5]
            value = number(raw_value) if value_type in {"NM", "SN", ""} else raw_value
            unit_parts = fields[6].split(component_sep) if len(fields) > 6 else [""]
            unit = unit_parts[1] if len(unit_parts) > 1 and unit_parts[1] else unit_parts[0]
            obx_ts = self.parse_ts(fields[14]) if len(fields) > 14 else None
            row = self.observation(code or label, param, value, unit, obx_ts or observed_ts, frame.ts)
            if row:
                rows.append(row)
        return rows

    def parse_ts(self, value: str) -> int | None:
        value = (value or "").split("^")[0].strip()
        if len(value) < 12:
            return None
        offset = None
        for sign in ("+", "-"):
            if sign in value[8:]:
                position = value.rindex(sign)
                value, offset = value[:position], value[position:]
                break
        digits = value.split(".")[0]
        try:
            moment = datetime.strptime(digits[:14].ljust(14, "0"), "%Y%m%d%H%M%S")
        except ValueError:
            return None
        if offset and len(offset) == 5:
            minutes = int(offset[1:3]) * 60 + int(offset[3:5])
            minutes = minutes if offset[0] == "+" else -minutes
            epoch = (moment - datetime(1970, 1, 1)).total_seconds() - minutes * 60
            return int(epoch * 1000)
        return int(moment.replace(tzinfo=self.zone).timestamp() * 1000)
