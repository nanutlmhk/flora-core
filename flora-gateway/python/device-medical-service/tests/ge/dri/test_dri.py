import json
from tests.support import FIXTURES
import struct
import pytest
from device_medical_service.envelope import RawFrame, encode
from device_medical_service.parsers import load_parser
from device_medical_service.parsers.ge.dri.parser import decode_basic, decode_record, frame_packet, display_request

REFERENCE=json.loads((FIXTURES/'hidro_reference.json').read_text())


def test_dri_integer_rounding_matches_javascript():
    data = bytearray(270)
    struct.pack_into('<h', data, 78, 12050)
    struct.pack_into('<h', data, 124, 9850)
    values = decode_basic(data)
    assert values['NIBP_SYS'] == 121
    assert values['SpO2'] == 99


def raw(data,pod='serial.ge',**meta):
    encoding,payload=encode(data)
    return RawFrame(pod,pod.split('.')[0],'gateway-test',1,123456,encoding,payload,meta)


def test_dri_matches_node_basic_values_and_profiles():
    data=bytes.fromhex(REFERENCE['dri']['record'])
    values,stamp=decode_record(data)
    expected=REFERENCE['dri']['expected']['results'][0]['vals']
    for key,value in expected.items():
        assert values[key]==(float(value) if key.startswith('T') else value)
    assert stamp==1767225600000
    for profile,levels,mode in [('gebx50',[12,11,10,9,8,6],'escaped'),('geaisyscs2',[12,11,10,9,8,6],'payload'),('ges5',[9,8,7],'payload')]:
        requests=b''.join(display_request(5,l,mode) for l in levels)
        assert requests.hex()==REFERENCE['dri_requests'][profile]


@pytest.mark.parametrize('mode',['payload','escaped'])
def test_dri_frames_units_roles_and_fragmentation(mode):
    data=bytes.fromhex(REFERENCE['dri']['record'])
    framed=frame_packet(data,mode)
    options={'checksum_mode':mode,'pressure_roles':{'P1':'ART','P2':'CVP'},'tidal_volume_scale_ml':.1}
    for split in range(1,len(framed)):
        parser=load_parser('ge_dri','monitor','serial.ge',options)
        rows=parser.feed(raw(framed[:split]))+parser.feed(raw(framed[split:]))
        values={r['ivy_param']:r for r in rows}
        assert values['hr']['value']==72
        assert values['art_sys']['value']==121 and values['cvp']['value']==6
        assert values['temperature']['value']==36.5
        assert values['tidal_volume_exp']['value']==450 and values['tidal_volume_exp']['unit']=='mL'
        assert values['et_co2']['value']==pytest.approx(39.528)
        assert values['agent_id']['value']=='SEV'


def test_dri_extension_bounds_invalid_values_and_checksum():
    data=bytearray.fromhex(REFERENCE['dri']['record'])
    parser=load_parser('ge_dri','monitor','serial.ge')
    rows=parser.feed(raw(frame_packet(data)))
    assert any(r['ivy_param']=='dri_tidal_volume_exp' for r in rows)
    assert not any(r['ivy_param']=='tidal_volume_exp' for r in rows)
    struct.pack_into('<h',data,44+6,-32766)
    assert 'HR' not in decode_record(data)[0]
    # A short basic block must not read into the next extension.
    struct.pack_into('<hB',data,19,10,1)
    data[22]=255
    with pytest.raises(ValueError,match='truncated'):
        decode_record(data)
    assert parser.feed(raw(frame_packet(data)))==[]
    valid=bytes.fromhex(REFERENCE['dri']['record'])
    bad=bytearray(frame_packet(valid));bad[-2]^=1
    assert parser.feed(raw(bytes(bad)))==[]
    assert parser.feed(raw(frame_packet(valid)))
