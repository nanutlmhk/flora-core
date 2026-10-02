"""B. Braun SpaceCom BCC read protocol, ported from Hidro (MIT)."""
import time

from device_medical_service.envelope import command
from device_medical_service.parsers.shared.base import Parser
from device_medical_service.parsers.shared.helpers import mapping, numeric, positive


def escape(data):
    return b''.join({68:b'EX',69:b'EE',100:b'ex',101:b'ee'}.get(b,bytes((b,))) for b in data)


def unescape(data):
    out=bytearray()
    pos=0
    while pos<len(data):
        b=data[pos]
        if b in (69,101):
            pair=data[pos:pos+2]
            if pair not in {b'EX',b'EE',b'ex',b'ee'}:
                raise ValueError('invalid BCC escape')
            out.extend({b'EX':b'D',b'EE':b'E',b'ex':b'd',b'ee':b'e'}[pair])
            pos+=2
        else:
            out.append(b)
            pos+=1
    return bytes(out)


def build_request(bed_id, text):
    text=f'{bed_id}>{text}'.encode('ascii')
    length=len(text)+14
    if length>99999:
        raise ValueError('BCC message too long')
    body=b'\x01'+f'{length:05d}'.encode()+b'\x02'+text+b'\x03'
    return escape(body+f'{sum(body)&255:05d}'.encode())+b'\x04'


def decode_packet(wire):
    data=unescape(wire)
    if len(data)<13 or data[0]!=1 or data[6]!=2 or data[-6]!=3:
        raise ValueError('invalid BCC frame markers')
    if not data[1:6].isdigit() or int(data[1:6]) != len(data)+1:
        raise ValueError('BCC length mismatch')
    if not data[-5:].isdigit() or int(data[-5:]) != sum(data[:-5])&255:
        raise ValueError('BCC checksum mismatch')
    text=data[7:-6].decode('ascii')
    bed,sep,body=text.partition('>')
    if not sep:
        raise ValueError('missing BCC bed separator')
    records=[]
    for record in body.split('\x1e'):
        parts=record.strip().split(',',3)
        if len(parts)==4 and parts[2]:
            records.append(tuple(p.strip() for p in parts))
    return bed.strip(),records


class BBraunBccParser(Parser):
    name='bbraun_bcc'
    protocol='bbraun-bcc'

    def __init__(self,device_id,pod,options=None):
        super().__init__(device_id,pod,options)
        self.bed_id=str(self.options.get('bed_id','1/1/1'))
        self.address=str(self.options.get('address',''))
        if not self.address:
            raise ValueError('BCC address is required to keep pump channels separate')
        for value in (self.bed_id,self.address):
            if not value.isascii() or any(ord(ch)<32 or ch in ',>' for ch in value):
                raise ValueError('invalid BCC bed_id or address')
        self.interval=positive(self.options,'poll_interval_sec',5)
        self.timeout=positive(self.options,'session_timeout_sec',15)
        self.max_frame=int(self.options.get('max_frame_bytes',262144))
        if self.max_frame<14:
            raise ValueError('max_frame_bytes must be at least 14')
        self.parameters={**mapping(__file__),**self.options.get('parameters',{})}
        self.reset()

    def reset(self):
        self.buffer=bytearray()
        self.outgoing=[]
        self.alive=False
        self.last_receive=time.monotonic()
        self.connection=None

    @property
    def poll_interval(self):
        return self.interval

    def poll(self):
        if time.monotonic()-self.last_receive>self.timeout:
            self.reset()
        if not self.alive:
            self.alive=True
            return [command(self.pod,build_request('1/1/1','ADMIN:ALIVE'))]
        return [command(self.pod,build_request(self.bed_id,'MEM:GET'))]

    def drain_commands(self):
        result,self.outgoing=self.outgoing,[]
        return result

    def feed(self,frame):
        if frame.pod!=self.pod:
            return []
        if frame.meta.get('event') in {'connected','disconnected'}:
            self.reset()
            self.connection=frame.meta.get('connection')
            return []
        conn=frame.meta.get('connection')
        if conn is not None and self.connection is not None and conn!=self.connection:
            self.reset()
        self.connection=conn
        rows=[]
        for byte in frame.data:
            if byte==1:
                self.buffer=bytearray((1,))
            elif self.buffer and byte==4:
                wire,self.buffer=bytes(self.buffer),bytearray()
                try:
                    bed,records=decode_packet(wire)
                except (ValueError,UnicodeError):
                    continue
                self.last_receive=time.monotonic()
                target={'connection':conn} if conn is not None else {}
                self.outgoing.append(command(self.pod,b'\x06',**target))
                if bed!=self.bed_id:
                    continue
                selected=[r for r in records if r[1]==self.address]
                units={code:value for _,_,code,value in selected}
                for relative,address,code,text in selected:
                    rule=self.parameters.get(code)
                    if not rule or not text:
                        continue
                    value=numeric(text.replace(',','.')) if rule.get('numeric') else text
                    if value is None:
                        continue
                    unit=rule['unit']
                    if code=='INDCON': unit=units.get('INDCONU',unit)
                    if code=='INDORT': unit=units.get('INDORTU',unit)
                    row=self.observation(rule['raw_code'],rule['ivy_param'],value,unit,system_ts=frame.ts)
                    if row: rows.append(row)
            elif self.buffer:
                self.buffer.append(byte)
                if len(self.buffer)>self.max_frame:
                    self.buffer.clear()
        return rows
