import json
from tests.support import FIXTURES
import pytest
from device_medical_service.envelope import RawFrame, encode
from device_medical_service.parsers import load_parser
from device_medical_service.parsers.ge.carestation.parser import checksum, decode_fields, request

REFERENCE=json.loads((FIXTURES/'hidro_reference.json').read_text())


def raw(data,pod='serial.ge',**meta):
    encoding,payload=encode(data)
    return RawFrame(pod,pod.split('.')[0],'gateway-test',1,123456,encoding,payload,meta)


def wire(command):
    return RawFrame.from_dict(command).data


@pytest.mark.parametrize('fixture',REFERENCE['ge'])
def test_carestation_matches_node_reference(fixture):
    values=decode_fields(fixture['tag'].encode(),bytes.fromhex(fixture['data']))
    expected={k:v for k,v in fixture['expected'].items() if v is not None and k!='mech_rr_set'}
    assert values==expected
    parser=load_parser('ge_carestation','anesthesia','serial.ge')
    rows=parser.feed(raw(bytes.fromhex(fixture['wire'])))
    assert len(rows)==len([k for k in values if k in parser.parameters])
    assert all(r['device_id']=='anesthesia' and r['system_ts']==123456 for r in rows)
    co2=[r for r in rows if r['raw_code']=='GE750_ETCO2']
    if co2:
        assert co2[0]['ivy_param']=='et_co2_pct' and co2[0]['unit']=='%'


def test_carestation_fragmentation_corruption_and_control_char_checksums():
    fixture=bytes.fromhex(REFERENCE['ge'][0]['wire'])
    for split in range(1,len(fixture)):
        parser=load_parser('ge_carestation','anesthesia','serial.ge')
        assert len(parser.feed(raw(fixture[:split]))+parser.feed(raw(fixture[split:])))>30
    parser=load_parser('ge_carestation','anesthesia','serial.ge')
    bad=bytearray(fixture);bad[8]^=1
    assert parser.feed(raw(bytes(bad)))==[]
    assert parser.feed(raw(b'noise'+fixture))
    for wanted in (13,58):
        # Fixed-width data can produce a checksum equal to CR or ':'.
        body=bytearray(b'VTd'+b'04500650014040021017010003')
        for n in range(1000):
            candidate=body+f'{n:03d}'.encode()+b' '*n
            if checksum(b':'+candidate)==wanted:
                break
        assert checksum(b':'+candidate)==wanted
        test=load_parser('ge_carestation','anesthesia','serial.ge')
        assert test.feed(raw(b':'+candidate+bytes((wanted,13))))


def test_carestation_initialization_and_reconnect(monkeypatch):
    clock=[100.]
    monkeypatch.setattr('device_medical_service.parsers.ge.carestation.parser.time.monotonic',lambda:clock[0])
    parser=load_parser('ge_carestation','anesthesia','serial.ge')
    for cmd in ['VTE','VTO12','VTX']:
        assert wire(parser.poll()[0]).hex()==REFERENCE['ge_commands'][cmd]
    assert parser.poll()==[]
    clock[0]+=31
    assert wire(parser.poll()[0])==request('VTE')
    parser.feed(raw(b'',event='connected'))
    assert wire(parser.poll()[0])==request('VTE')
