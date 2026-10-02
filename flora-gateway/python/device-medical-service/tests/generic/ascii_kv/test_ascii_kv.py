from device_medical_service.envelope import RawFrame
from device_medical_service.parsers import load_parser


def frame(payload: str, pod: str = "socket.or-monitor") -> RawFrame:
    return RawFrame(pod=pod, controller="socket", gateway_id="gw", seq=1, ts=1_000, encoding="utf8", payload=payload)


def test_ascii_kv_buffers_partial_lines_and_polls():
    parser = load_parser("ascii_kv", "or-module-01", "serial.COM1", {
        "codes": {"TEMP": "temperature", "MAC": "mac"}, "poll_command": "?\\r\\n", "poll_interval_sec": 5,
    })
    assert parser.feed(frame("TEMP=36.", "serial.COM1")) == []
    rows = parser.feed(frame("8;MAC=1.1\r\n", "serial.COM1"))
    assert [(row["ivy_param"], row["value"]) for row in rows] == [("temperature", 36.8), ("mac", 1.1)]
    assert parser.poll()[0]["payload"] == "?\r\n"
    assert parser.poll()[0]["pod"] == "serial.COM1"
