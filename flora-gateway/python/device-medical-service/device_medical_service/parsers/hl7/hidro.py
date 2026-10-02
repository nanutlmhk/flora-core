"""Hidro's shared HL7 aliases on Flora's MLLP/HL7 path (MIT)."""
from dataclasses import replace
import re

from device_medical_service.parsers.hl7.parser import Hl7v2Parser
from device_medical_service.parsers.shared.helpers import mapping


class HidroHl7Parser(Hl7v2Parser):
    name='hidro_hl7'

    def __init__(self,device_id,pod,options=None):
        aliases=mapping(__file__)
        options=dict(options or {})
        options['codes']={**{k:v['ivy_param'] for k,v in aliases.items()},**options.get('codes',{})}
        super().__init__(device_id,pod,options)
        self.units={v['ivy_param']:v['unit'] for v in aliases.values()}

    def feed(self,frame):
        if frame.pod!=self.pod:
            return []
        source=self.options.get('source_ip')
        if source and frame.meta.get('source_ip')!=source:
            return []
        text=frame.text
        # Hidro accepts legacy feeds with OBR/OBX appended without segment CR.
        if self.options.get('repair_segments',False):
            text=re.sub(r'\|(OBR|OBX)\|',r'\r\1|',text)
        rows=super().feed(replace(frame,encoding='utf8',payload=text))
        for row in rows:
            if not row['unit']:
                row['unit']=self.units.get(row['ivy_param'],'')
        # Preserve valid zero measurements; legacy Hidro's global zero filter
        # incorrectly discarded legitimate values such as inspired CO2 = 0.
        return [row for row in rows if isinstance(row['value'],(int,float))]
