"""Line-oriented `KEY=VALUE;KEY=VALUE` output used by many RS-232 modules.

Options:
  poll_command       bytes written to the device every poll_interval_sec (e.g. "?\\r\\n")
  poll_interval_sec  enables polling
  pair_separator     default ";" (commas also accepted)
  units              {"temperature": "Cel", ...}
"""
from __future__ import annotations

import re
from typing import Any

from device_medical_service.envelope import RawFrame, command
from device_medical_service.parsers.shared.base import Parser, number


class AsciiKvParser(Parser):
    name = "ascii_kv"
    protocol = "ascii"

    def __init__(self, device_id: str, pod: str, options: dict[str, Any] | None = None):
        super().__init__(device_id, pod, options)
        self.buffer = ""
        separator = re.escape(self.options.get("pair_separator", ";"))
        self.pair_split = re.compile(rf"[{separator},]")
        self.units = self.options.get("units") or {}

    def poll(self) -> list[dict[str, Any]]:
        poll_command = self.options.get("poll_command")
        if not poll_command:
            return []
        return [command(self.pod, poll_command.encode().decode("unicode_escape"))]

    def feed(self, frame: RawFrame) -> list[dict[str, Any]]:
        self.buffer += frame.text
        *lines, self.buffer = re.split(r"\r?\n|\r", self.buffer)
        rows: list[dict[str, Any]] = []
        for line in lines:
            for pair in self.pair_split.split(line):
                if "=" not in pair and ":" not in pair:
                    continue
                key, value = re.split(r"[=:]", pair, maxsplit=1)
                param = self.map_code(key)
                if not param:
                    continue
                row = self.observation(key.strip(), param, number(value), self.units.get(param, ""), None, frame.ts)
                if row:
                    rows.append(row)
        if len(self.buffer) > 4096:
            self.buffer = ""
        return rows
