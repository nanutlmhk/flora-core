import json
from device_medical_service.envelope import RawFrame
from device_medical_service.parsers import load_parser


def frame(payload: str, pod: str = "socket.or-monitor") -> RawFrame:
    return RawFrame(pod=pod, controller="socket", gateway_id="gw", seq=1, ts=1_000, encoding="utf8", payload=payload)


def test_json_values_and_observation_lists():
    parser = load_parser("json_fields", "icu-vent-01", "feeder.icu-ventilator", {"codes": {"PEEP": "set_peep"}})
    rows = parser.feed(frame(json.dumps({"device_ts": 5, "values": {"PEEP": 5, "fio2": 40, "ignored": 1}})))
    assert [(row["ivy_param"], row["value"], row["device_ts"]) for row in rows] == [("set_peep", 5, 5), ("fio2", 40, 5)]
    rows = parser.feed(frame(json.dumps([{"code": "et_agent", "value": "1.2", "unit": "%"}])))
    assert rows[0]["value"] == 1.2 and rows[0]["unit"] == "%"
