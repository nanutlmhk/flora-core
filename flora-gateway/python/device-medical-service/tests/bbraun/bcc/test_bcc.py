import json
from tests.support import FIXTURES
import pytest
from device_medical_service.envelope import RawFrame, encode
from device_medical_service.parsers import load_parser
from device_medical_service.parsers.bbraun.bcc.parser import build_request, decode_packet

REFERENCE=json.loads((FIXTURES/'hidro_reference.json').read_text())


def raw(data,pod='serial.ge',**meta):
    encoding,payload=encode(data)
    return RawFrame(pod,pod.split('.')[0],'gateway-test',1,123456,encoding,payload,meta)


def wire(command):
    return RawFrame.from_dict(command).data


def test_bcc_node_reference_and_pump_isolation():
    fixture=REFERENCE['bcc'];data=bytes.fromhex(fixture['wire'])
    bed,records=decode_packet(data[:-1])
    assert bed==fixture['expected']['bedId']
    assert [r[2] for r in records]==[r['rawCode'] for r in fixture['expected']['records']]
    for split in range(1,len(data)):
        parser=load_parser('bbraun_bcc','pump-1','socket.bcc',{'address':'1'})
        rows=parser.feed(raw(data[:split],'socket.bcc',connection=9))+parser.feed(raw(data[split:],'socket.bcc',connection=9))
        values={r['ivy_param']:r for r in rows}
        assert values['infusion_rate']['value']==12.5
        assert values['drug_name']['value']=='Dextrose'
        assert values['drug_concentration']['unit']=='mg/mL'
        replies=parser.drain_commands()
        assert len(replies)==1 and wire(replies[0])==b'\x06' and replies[0]['meta']['connection']==9
    with pytest.raises(ValueError,match='address'):
        load_parser('bbraun_bcc','pump','socket.bcc')


def test_bcc_poll_reset_corruption_and_bed_filter():
    parser=load_parser('bbraun_bcc','pump','socket.bcc',{'address':'1'})
    assert wire(parser.poll()[0]).hex()==REFERENCE['bcc']['alive']
    assert wire(parser.poll()[0]).hex()==REFERENCE['bcc']['poll']
    parser.feed(raw(b'','socket.bcc',event='connected',connection=2))
    assert wire(parser.poll()[0]).hex()==REFERENCE['bcc']['alive']
    good=bytes.fromhex(REFERENCE['bcc']['wire'])
    bad=bytearray(good);bad[-3]^=1
    assert parser.feed(raw(bytes(bad),'socket.bcc'))==[]
    assert parser.drain_commands()==[]
    assert parser.feed(raw(build_request('other','0,1,INRT,33'),'socket.bcc'))==[]
    assert wire(parser.drain_commands()[0])==b'\x06'
    assert parser.feed(raw(good,'socket.bcc'))
