"""Shared helpers for the Hidro ports (MIT; see THIRD_PARTY_NOTICES.md)."""
import json
import math
import re
from pathlib import Path


def mapping(module_file):
    """Load parameters.json beside the calling protocol's module (__file__)."""
    return json.loads((Path(module_file).parent / 'parameters.json').read_text())['parameters']


def numeric(data):
    text = data.decode('ascii') if isinstance(data, bytes) else str(data)
    text = text.strip()
    if not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)', text):
        return None
    value = float(text)
    return value if math.isfinite(value) else None


def positive(options, key, default):
    value = float(options.get(key, default))
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f'{key} must be finite and positive')
    return value
