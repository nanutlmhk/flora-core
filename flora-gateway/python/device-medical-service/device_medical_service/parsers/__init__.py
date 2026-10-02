from typing import Any

from .ascii_kv import AsciiKvParser
from .base import Parser
from .hl7v2 import Hl7v2Parser
from .json_fields import JsonFieldsParser

PARSERS: dict[str, type[Parser]] = {
    parser.name: parser for parser in (Hl7v2Parser, AsciiKvParser, JsonFieldsParser)
}


def load_parser(name: str, device_id: str, pod: str, options: dict[str, Any] | None = None) -> Parser:
    try:
        return PARSERS[name](device_id, pod, options)
    except KeyError:
        raise ValueError(f"unknown parser {name!r}; available: {', '.join(sorted(PARSERS))}") from None
