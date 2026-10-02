from device_medical_service.envelope import RawFrame, encode
from device_medical_service.parsers import load_parser


def raw(data,pod='serial.ge',**meta):
    encoding,payload=encode(data)
    return RawFrame(pod,pod.split('.')[0],'gateway-test',1,123456,encoding,payload,meta)


def test_hidro_hl7_aliases_zero_units_and_source_identity():
    parser=load_parser('hidro_hl7','monitor','socket.hl7',{'source_ip':'192.0.2.10','repair_segments':True})
    message=b'MSH|^~\\&|GE|OR|FLORA|GW|20260101083000+0700||ORU^R01|1|P|2.5\rOBX|1|NM|149514||72||||||F|OBX|2|NM|151876||0||||||F\rOBX|3|NM|131841||12||||||F\r'
    assert parser.feed(raw(message,'socket.hl7',source_ip='192.0.2.11'))==[]
    rows=parser.feed(raw(message,'socket.hl7',source_ip='192.0.2.10'))
    assert [(r['ivy_param'],r['value'],r['unit']) for r in rows]==[('hr',72,'bpm'),('fi_co2',0,'mmHg'),('st_i',12,'uV')]
