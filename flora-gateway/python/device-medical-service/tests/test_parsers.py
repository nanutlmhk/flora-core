import json

from device_medical_service.envelope import RawFrame
from device_medical_service.parsers import load_parser


def frame(payload: str, pod: str = "socket.or-monitor") -> RawFrame:
    return RawFrame(pod=pod, controller="socket", gateway_id="gw", seq=1, ts=1_000, encoding="utf8", payload=payload)


def test_hl7_oru_maps_mdc_codes_and_timestamps():
    message = "\r".join([
        "MSH|^~\\&|MON|OR1|FLORA|GW|20260101083000+0700||ORU^R01^ORU_R01|1|P|2.6",
        "PID|1||D-HL7-001",
        "OBR|1|||182777000^monitoring of patient^SCT|||20260101083000+0700",
        "OBX|1|NM|147842^MDC_ECG_HEART_RATE^MDC|1.1|72|264864^/min^MDC|||||F",
        "OBX|2|NM|150456^MDC_PULS_OXIM_SAT_O2^MDC|1.2|98|262688^%^MDC|||||F",
        "OBX|3|NM|999999^UNKNOWN^MDC|1.3|5|||||F",
    ])
    rows = load_parser("hl7v2", "or-monitor-01", "socket.or-monitor").feed(frame(message))
    assert [(row["ivy_param"], row["value"], row["unit"]) for row in rows] == [("hr", 72, "/min"), ("spo2", 98, "%")]
    assert rows[0]["device_ts"] == 1767231000000
    assert rows[0]["system_ts"] == 1_000


def test_ascii_kv_buffers_partial_lines_and_polls():
    parser = load_parser("ascii_kv", "or-module-01", "serial.COM1", {
        "codes": {"TEMP": "temperature", "MAC": "mac"}, "poll_command": "?\\r\\n", "poll_interval_sec": 5,
    })
    assert parser.feed(frame("TEMP=36.", "serial.COM1")) == []
    rows = parser.feed(frame("8;MAC=1.1\r\n", "serial.COM1"))
    assert [(row["ivy_param"], row["value"]) for row in rows] == [("temperature", 36.8), ("mac", 1.1)]
    assert parser.poll()[0]["payload"] == "?\r\n"
    assert parser.poll()[0]["pod"] == "serial.COM1"


def test_json_values_and_observation_lists():
    parser = load_parser("json_fields", "icu-vent-01", "feeder.icu-ventilator", {"codes": {"PEEP": "set_peep"}})
    rows = parser.feed(frame(json.dumps({"device_ts": 5, "values": {"PEEP": 5, "fio2": 40, "ignored": 1}})))
    assert [(row["ivy_param"], row["value"], row["device_ts"]) for row in rows] == [("set_peep", 5, 5), ("fio2", 40, 5)]
    rows = parser.feed(frame(json.dumps([{"code": "et_agent", "value": "1.2", "unit": "%"}])))
    assert rows[0]["value"] == 1.2 and rows[0]["unit"] == "%"
