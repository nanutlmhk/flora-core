"""JSON payloads from webhook pushes or feeder polls.

Accepted shapes:
  {"device_ts": 1700000000000, "values": {"hr": 72, "spo2": 98}}
  {"observations": [{"code": "HR", "value": 72, "unit": "/min", "ts": ...}, ...]}
  [{"code": ..., "value": ...}, ...]
Codes are mapped with the `codes` option, then matched against Flora parameter keys.
"""
from __future__ import annotations

import json
from typing import Any

from ..envelope import RawFrame
from .base import Parser, number


class JsonFieldsParser(Parser):
    name = "json_fields"
    protocol = "json"

    def feed(self, frame: RawFrame) -> list[dict[str, Any]]:
        try:
            document = json.loads(frame.text)
        except json.JSONDecodeError:
            return []
        units = self.options.get("units") or {}
        rows: list[dict[str, Any]] = []
        if isinstance(document, dict) and isinstance(document.get("values"), dict):
            device_ts = document.get("device_ts") or document.get("ts")
            for key, value in document["values"].items():
                param = self.map_code(key)
                if param:
                    row = self.observation(key, param, number(value), units.get(param, ""), device_ts, frame.ts)
                    if row:
                        rows.append(row)
            return rows
        items = document.get("observations", []) if isinstance(document, dict) else document
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            code = str(item.get("code") or item.get("param") or item.get("ivy_param") or "")
            param = self.map_code(code, str(item.get("label") or ""))
            if not param:
                continue
            row = self.observation(code, param, number(item.get("value")), item.get("unit") or units.get(param, ""),
                                   item.get("ts") or item.get("device_ts"), frame.ts)
            if row:
                rows.append(row)
        return rows
