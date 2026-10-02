"""GE Carestation 750 / Aisys COM 1.2, ported from Hidro (MIT)."""
import math
import time

from device_medical_service.envelope import command
from device_medical_service.parsers.shared.base import Parser
from device_medical_service.parsers.shared.helpers import mapping, numeric, positive

MODES = dict(v='VCV', p='PCV', b='VCV-BU', g='PCV-VG', G='BiLevel-VG',
             s='SIMV-VC', i='SIMV-PC', S='SIMV-PCVG', B='BiLevel', c='CPAP/PSV',
             a='CPAP-Apnea', n='NIV', o='PSV-Pro', m='MAN', M='MAN')
MODES.update({'@': 'VCV', '-': 'BAG'})
AGENTS = {'1': 'ISO', '5': 'DES', '6': 'SEVO'}

# (name, start, stop, divisor, minimum data length), relative to after VTd/VTq.
MEASURED = [
    ('tidal_volume_exp',0,4,1,26), ('minute_volume',4,8,100,26),
    ('resp_rate',8,11,1,26), ('fio2',11,14,1,26),
    ('airway_pressure_peak',14,17,1,26), ('airway_pressure_plat',17,20,1,26),
    ('airway_pressure_mean',20,23,1,26), ('airway_pressure_min',23,26,1,26),
    ('mv_spont',26,30,100,71), ('rr_spont',30,33,1,71),
    ('peep_intrinsic',33,36,10,71), ('compliance',36,38,1,71),
    ('airway_resistance',38,41,10,71), ('tidal_volume_exp_spont',43,47,1,71),
    ('tidal_volume_insp',47,51,1,71), ('minute_volume_insp',51,55,100,71),
    ('peep_extrinsic',64,67,10,71), ('peep_total',67,70,10,71),
    ('fio2_meas',79,82,1,121), ('et_o2',82,85,1,121),
    ('fi_co2',89,92,10,121), ('et_co2',92,95,10,121), ('rr_co2',95,98,1,121),
    ('fi_agent',98,101,10,121), ('et_agent',101,104,10,121),
    ('fi_agent_2nd',105,108,10,121), ('et_agent_2nd',108,111,10,121),
    ('fi_n2o',112,115,10,121), ('et_n2o',115,118,10,121), ('mac',118,120,10,121),
    ('pressure_o2_supply',144,147,1,154), ('pressure_n2o_supply',147,150,1,154),
    ('pressure_air_supply',150,153,1,154), ('flow_o2',180,184,100,193),
    ('flow_n2o',184,188,100,193), ('flow_air',188,192,100,193),
    ('t_insp_meas',195,198,10,202), ('t_exp_meas',198,201,10,202),
]
SETTINGS = [
    ('tv_set',0,4,1,20), ('rr_set',4,7,1,20), ('tpause_set',11,13,1,20),
    ('peep_set',13,15,1,20), ('peak_limit',15,18,1,20), ('insp_pres_set',18,20,1,20),
    ('fio2_set',46,49,1,50), ('psupp',51,53,1,54), ('flow_trigger',119,121,10,122),
    ('end_flow',125,127,1,128), ('t_insp_set',127,131,10,132), ('fgf_total',167,171,100,172),
]


def checksum(data):
    return (-sum(data)) & 0x7f


def request(text):
    body = b'\x1b' + text.encode('ascii')
    return body + bytes((checksum(body), 13))


def decode_fields(tag, data):
    result = {}
    for key, start, stop, divisor, minimum in MEASURED if tag == b'VTD' else SETTINGS:
        if len(data) >= minimum:
            value = numeric(data[start:stop])
            if value is not None:
                result[key] = value / divisor
    if tag == b'VTD':
        if len(data) > 120:
            for key, offset in [('agent_id',104), ('agent_id_2nd',111)]:
                if chr(data[offset]) in AGENTS:
                    result[key] = AGENTS[chr(data[offset])]
        return result
    if len(data) > 138:
        rate = numeric(data[136:138])
        if 'rr_set' not in result and rate is not None:
            result['rr_set'] = rate
    if len(data) > 40:
        # Preserve Hidro's firmware-dependent mode selection.
        positions = [40,41,39,42] if len(data) < 100 else [42,41,43,40,44]
        mode = next((chr(data[i]) for i in positions if i < len(data) and chr(data[i]) in MODES), None)
        if mode:
            result['vent_mode'] = MODES[mode]
    denominator = numeric(data[7:11]) if len(data) >= 11 else None
    if denominator is not None:
        denominator /= 10
    elif result.get('rr_set',0) > 0 and result.get('t_insp_set',0) > 0:
        denominator = (60 / result['rr_set'] - result['t_insp_set']) / result['t_insp_set']
    if denominator is not None and denominator > 0:
        result['ie_ratio'] = f'1:{math.floor(denominator * 2 + 0.5) / 2:g}'
    return result


class GeCarestationParser(Parser):
    name = 'ge_carestation'
    protocol = 'ge-datex-com12'

    def __init__(self, device_id, pod, options=None):
        super().__init__(device_id, pod, options)
        self.interval = positive(self.options, 'poll_interval_sec', 1)
        self.timeout = positive(self.options, 'session_timeout_sec', 30)
        self.max_frame = int(self.options.get('max_frame_bytes', 4096))
        if self.max_frame < 32:
            raise ValueError('max_frame_bytes must be at least 32')
        self.parameters = {**mapping(__file__), **self.options.get('parameters', {})}
        self.reset()

    def reset(self):
        self.buffer = bytearray()
        self.collecting = False
        self.init_step = 0
        self.last_data = time.monotonic()

    @property
    def poll_interval(self):
        return self.interval

    def poll(self):
        if time.monotonic() - self.last_data > self.timeout:
            self.reset()
        if self.init_step < 3:
            text = ('VTE','VTO12','VTX')[self.init_step]
            self.init_step += 1
            return [command(self.pod, request(text))]
        return []  # VTX is autonomous; initialization is repeated after inactivity.

    def feed(self, frame):
        if frame.pod != self.pod:
            return []
        if frame.meta.get('event') in {'connected','disconnected'}:
            self.reset()
            return []
        rows = []
        for byte in frame.data:
            # Checksum may itself be ':' or CR; the byte after it ends the frame.
            if self.collecting and byte == 13 and len(self.buffer) >= 4 and self.buffer[-1] == checksum(b':' + self.buffer[:-1]):
                body = bytes(self.buffer[:-1])
                self.buffer.clear()
                self.collecting = False
                self.last_data = time.monotonic()
                tag = body[:3].upper()
                if tag not in {b'VTD',b'VTQ'}:
                    continue
                for key, value in decode_fields(tag, body[3:]).items():
                    rule = self.parameters.get(key)
                    if not rule:
                        continue
                    row = self.observation(rule['raw_code'], rule['ivy_param'], value,
                                           rule['unit'], system_ts=frame.ts)
                    if row:
                        rows.append(row)
            elif byte == 58 and (not self.collecting or len(self.buffer) < 3 or checksum(b':' + self.buffer) != 58):
                self.buffer.clear()
                self.collecting = True
            elif self.collecting:
                self.buffer.append(byte)
                if len(self.buffer) > self.max_frame:
                    self.buffer.clear()
                    self.collecting = False
        return rows
