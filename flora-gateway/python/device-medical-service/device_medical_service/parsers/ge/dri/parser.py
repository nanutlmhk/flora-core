"""GE S/5, Bx50 and legacy Aisys DRI; ported from Hidro (MIT)."""
import math
import struct

from device_medical_service.envelope import command
from device_medical_service.parsers.shared.base import Parser
from device_medical_service.parsers.shared.helpers import positive

INVALID = {-32767, -32766}
AGENTS = ['Unknown','None','HAL','ENF','ISO','DES','SEV']
# Basic PHDB offsets; extension classes are intentionally not read as basic data.
FIELDS = {
    'HR': (6,1,0), 'RR_IMP': (14,1,0),
    'NIBP_SYS': (78,.01,0), 'NIBP_DIA': (80,.01,0), 'NIBP_MEAN': (82,.01,0),
    'SpO2': (124,.01,0), 'SpO2_PR': (126,1,0), 'CO2_RR': (142,1,0),
    'O2_ET': (152,.01,1), 'O2_FI': (154,.01,1), 'N2O_ET': (162,.01,1), 'N2O_FI': (164,.01,1),
    'AA_ET': (172,.01,2), 'AA_FI': (174,.01,2), 'AA_MAC': (176,.01,2),
    'FV_RR': (184,1,0), 'FV_PPEAK': (186,.01,1), 'FV_PEEP': (188,.01,1),
    'FV_PPLAT': (190,.01,1), 'FV_TV_INSP': (192,.1,2), 'FV_TV_EXP': (194,.1,2),
    'FV_COMPLIANCE': (196,.01,1), 'FV_MV_EXP': (198,.01,2),
}
for channel in range(1,5):
    for kind, offset in [('SYS',22),('DIA',24),('MEAN',26),('HR',28)]:
        FIELDS[f'P{channel}_{kind}'] = (offset + (channel-1)*14, 1 if kind=='HR' else .01, 0 if kind=='HR' else 1)
    FIELDS[f'T{channel}'] = (92+(channel-1)*8,.01,2)


def escape(data):
    return b''.join(bytes((0x7d,b & ~0x20)) if b in (0x7d,0x7e) else bytes((b,)) for b in data)


def unescape(data):
    out = bytearray()
    pos = 0
    while pos < len(data):
        byte = data[pos]
        if byte == 0x7d:
            pos += 1
            if pos == len(data) or data[pos] not in (0x5d,0x5e):
                raise ValueError('invalid DRI escape')
            byte = data[pos] | 0x20
        out.append(byte)
        pos += 1
    return bytes(out)


def frame_packet(payload, checksum_mode='payload'):
    if checksum_mode == 'escaped':
        data = escape(payload)
        return b'\x7e' + data + bytes((sum(data)&255,)) + b'\x7e'
    return b'\x7e' + escape(payload + bytes((sum(payload)&255,))) + b'\x7e'


def display_request(interval, level, checksum_mode='payload'):
    data = bytearray(49)
    struct.pack_into('<H',data,0,49)
    data[3] = level
    data[19] = 255  # Legacy Hidro request layout: low byte of EOL offset.
    data[40] = 1
    struct.pack_into('<hI',data,41,interval,14)
    return frame_packet(bytes(data),checksum_mode)


def decode_basic(data):
    def read(offset):
        if offset+2 > len(data):
            return None
        value = struct.unpack_from('<h',data,offset)[0]
        return None if value in INVALID else value
    values = {}
    for key,(offset,scale,precision) in FIELDS.items():
        value = read(offset)
        if value is not None:
            scaled = value * scale
            # Hidro uses JavaScript Math.round for integer observations.
            values[key] = math.floor(scaled + .5) if precision == 0 else round(scaled, precision)
    ambient = read(144)
    for key,offset in [('CO2_ET',138),('CO2_FI',140)]:
        value = read(offset)
        if value is not None and ambient is not None and ambient > 0:
            values[key] = round(value * ambient * .00001,2)
    if len(data) >= 172:
        agent = struct.unpack_from('<H',data,170)[0]
        if agent < len(AGENTS):
            values['AA_AGENT'] = AGENTS[agent]
    if len(data) >= 78:
        values['NIBP_STATUS_BITS'] = struct.unpack_from('<I',data,72)[0]
        values['NIBP_LABEL_INFO'] = struct.unpack_from('<H',data,76)[0]
    return values


def decode_record(data):
    if len(data) < 40 or struct.unpack_from('<H',data)[0] != len(data):
        raise ValueError('DRI record length mismatch')
    if struct.unpack_from('<h',data,14)[0] != 0:
        return {},None
    offsets = []
    for pos in range(16,40,3):
        offset,kind = struct.unpack_from('<hB',data,pos)
        if offset & 255 == 255 or kind == 255:
            break
        if offset < 0 or 40 + offset + 4 > len(data):
            raise ValueError('invalid DRI subrecord offset')
        if offsets and offset <= offsets[-1][0]:
            raise ValueError('DRI subrecords must be ordered')
        offsets.append((offset,kind))
    if not offsets or offsets[0][1] not in (1,2,3):
        return {},None
    start = 40+offsets[0][0]+4
    end = 40+offsets[1][0] if len(offsets)>1 else len(data)
    # A basic block is 270 bytes. Never read into another extension subrecord.
    if end-start < 270:
        raise ValueError('truncated DRI basic block')
    stamp = struct.unpack_from('<I',data,6)[0]
    return decode_basic(data[start:start+270]), stamp*1000 if stamp else None


DEFAULT_MAP = {
    'HR': ('hr','/min'), 'SpO2': ('spo2','%'), 'SpO2_PR': ('pr','/min'),
    'NIBP_SYS': ('nibp_sys','mmHg'), 'NIBP_DIA': ('nibp_dia','mmHg'), 'NIBP_MEAN': ('nibp_map','mmHg'),
    'RR_IMP': ('rr_imp','/min'), 'CO2_RR': ('rr_co2','/min'), 'FV_RR': ('rr_vent','/min'),
    'O2_ET': ('et_o2','%'), 'O2_FI': ('fio2','%'), 'N2O_ET': ('et_n2o','%'), 'N2O_FI': ('fi_n2o','%'),
    'CO2_ET': ('et_co2','mmHg'), 'CO2_FI': ('fi_co2','mmHg'),
    'AA_ET': ('et_agent','%'), 'AA_FI': ('fi_agent','%'), 'AA_MAC': ('mac','1'), 'AA_AGENT': ('agent_id',''),
    'FV_PPEAK': ('airway_pressure_peak','cmH2O'), 'FV_PEEP': ('peep_total','cmH2O'),
    'FV_PPLAT': ('airway_pressure_plateau','cmH2O'), 'FV_COMPLIANCE': ('compliance','mL/cmH2O'),
    'FV_MV_EXP': ('minute_volume_exp','L/min'),
    'FV_TV_INSP': ('dri_tidal_volume_insp',''), 'FV_TV_EXP': ('dri_tidal_volume_exp',''),
    'NIBP_STATUS_BITS': ('nibp_status_bits',''), 'NIBP_LABEL_INFO': ('nibp_label_info',''),
}
for ch in range(1,5):
    DEFAULT_MAP[f'T{ch}'] = (f'temp{ch}','Cel')
    for kind in ['SYS','DIA','MEAN','HR']:
        DEFAULT_MAP[f'P{ch}_{kind}'] = (f'p{ch}_{"pr" if kind=="HR" else kind.lower()}', '/min' if kind=='HR' else 'mmHg')


class GeDriParser(Parser):
    name = 'ge_dri'
    protocol = 'ge-s5-dri'

    def __init__(self, device_id, pod, options=None):
        super().__init__(device_id,pod,options)
        self.interval = int(positive(self.options,'transmission_interval_sec',5))
        if not 5 <= self.interval <= 32767:
            raise ValueError('DRI transmission interval must be 5..32767 seconds')
        self.retry = positive(self.options,'poll_interval_sec',15)
        self.mode = self.options.get('checksum_mode','payload')
        if self.mode not in {'payload','escaped'}:
            raise ValueError('checksum_mode must be payload or escaped')
        self.levels = self.options.get('dri_levels',[9,8,7])
        if not self.levels or any(type(n) is not int or not 0 <= n <= 255 for n in self.levels):
            raise ValueError('dri_levels must contain byte values')
        self.roles = self.options.get('pressure_roles',{})
        if any(k not in {'P1','P2','P3','P4'} or v not in {'ART','CVP'} for k,v in self.roles.items()):
            raise ValueError('pressure_roles maps P1..P4 to ART or CVP')
        if len(set(self.roles.values())) != len(self.roles):
            raise ValueError('assign each pressure role to only one channel')
        self.tv_scale = self.options.get('tidal_volume_scale_ml')
        if self.tv_scale is not None:
            self.tv_scale = positive(self.options,'tidal_volume_scale_ml',1)
        self.temp_channel = self.options.get('temperature_channel','T1')
        self.rr_channel = self.options.get('respiration_channel','CO2_RR')
        if self.temp_channel not in {'T1','T2','T3','T4'} or self.rr_channel not in {'RR_IMP','CO2_RR','FV_RR'}:
            raise ValueError('invalid temperature or respiration channel')
        self.max_frame = int(self.options.get('max_frame_bytes',65536))
        if self.max_frame < 40:
            raise ValueError('max_frame_bytes must be at least 40')
        self.buffer = bytearray()
        self.collecting = False

    @property
    def poll_interval(self):
        return self.retry

    def poll(self):
        # Reassert the read subscription periodically, including after reconnect.
        return [command(self.pod,b''.join(display_request(self.interval,l,self.mode) for l in self.levels))]

    def feed(self, frame):
        if frame.pod != self.pod:
            return []
        if frame.meta.get('event') in {'connected','disconnected'}:
            self.buffer.clear()
            self.collecting = False
            return []
        rows = []
        for byte in frame.data:
            if byte == 0x7e:
                if self.buffer:
                    try:
                        if self.mode == 'escaped':
                            wire = bytes(self.buffer)
                            if sum(wire[:-1])&255 != wire[-1]:
                                raise ValueError('DRI checksum mismatch')
                            data = unescape(wire[:-1])
                        else:
                            data = unescape(self.buffer)
                            if sum(data[:-1])&255 != data[-1]:
                                raise ValueError('DRI checksum mismatch')
                            data = data[:-1]
                        values,stamp = decode_record(data)
                        rows.extend(self._rows(values,stamp,frame.ts))
                    except (ValueError,IndexError):
                        # Bx50's legacy checksum is unescaped and may equal FLAG.
                        if self.mode=='escaped' and sum(self.buffer)&255 == 0x7e and self.buffer[-1] != 0x7e:
                            self.buffer.append(byte)
                            continue
                self.buffer.clear()
                self.collecting = True
            elif self.collecting:
                self.buffer.append(byte)
                if len(self.buffer)>self.max_frame:
                    self.buffer.clear()
                    self.collecting = False
        return rows

    def _rows(self, values, stamp, ts):
        rows = []
        def emit(key,param,value,unit):
            row=self.observation('DRI_'+key,param,value,unit,stamp,ts)
            if row: rows.append(row)
        for key,value in values.items():
            param,unit = DEFAULT_MAP[key]
            if key in {'CO2_ET','CO2_FI'}:
                value = round(value*7.50061683,3)
            if key.startswith('FV_TV_') and self.tv_scale is not None:
                # Option is mL per *raw* signed integer, before legacy Ã—0.1.
                param = 'tidal_volume_insp' if key.endswith('INSP') else 'tidal_volume_exp'
                value = round(value*10*self.tv_scale,3)
                unit = 'mL'
            emit(key,param,value,unit)
        for key,param,unit in [(self.temp_channel,'temperature','Cel'),(self.rr_channel,'rr','/min')]:
            if key in values: emit(key,param,values[key],unit)
        for ch,role in self.roles.items():
            for suffix,param in ([('SYS','art_sys'),('DIA','art_dia'),('MEAN','art_map'),('HR','art_pr')] if role=='ART' else [('MEAN','cvp')]):
                key=f'{ch}_{suffix}'
                if key in values: emit(key,param,values[key],'/min' if suffix=='HR' else 'mmHg')
        return rows
