"""Hospital gateway and PostgreSQL-backed pre-admission buffer."""
import json
import os
import time
import urllib.error
import urllib.request

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from psycopg import Connection

from ..clinical import text
from ..database import connection
from ..demo_his import demo_patient_catalog, find_demo_patient
from .auth_leaf import require_permission
from .cases_lifecycle import editable_case

router = APIRouter(prefix="/api/case", tags=["HIS"], dependencies=[Depends(require_permission("case.read"))])
GATEWAY = os.getenv("HIS_GATEWAY_BASE_URL", "http://10.35.202.6:8590").rstrip("/")
TIMEOUT = max(3, int(os.getenv("HIS_GATEWAY_TIMEOUT_SECONDS", "45")))
DEMO_MODE = os.getenv("FLORA_HIS_DEMO_MODE", "false").strip().lower() == "true"

PATIENT_COLUMNS = ("hn","an","is_patient","notype","id_card","patient_name","title_th","title_en","first_name",
    "last_name","first_name_en","last_name_en","sex","dob","age_text","weight_kg","height_cm","blood_group_text",
    "blood_group_abo","blood_group_rh","race","ethnicity","religion","marital_status","present_address",
    "present_province","legal_address","legal_province","mobile","contact_name","contact_tel","relation_desc","nationality")


def gateway(path, payload):
    request = urllib.request.Request(GATEWAY + path, data=json.dumps(payload).encode(),
        headers={"Content-Type":"application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise RuntimeError(str(error)) from error


def rows(value):
    if isinstance(value, list): return value
    if isinstance(value, dict):
        for key in ("rows","data","result","Table","table"):
            if isinstance(value.get(key), list): return value[key]
        if value and any(not isinstance(item,(dict,list)) for item in value.values()): return [value]
    return []


def pick(row, *names):
    if not isinstance(row, dict): return None
    lowered={str(key).lower():value for key,value in row.items()}
    for name in names:
        value=lowered.get(name.lower())
        if value is not None and str(value).strip(): return value
    return None


def numeric(value):
    try: return float(value) if value not in (None,"") else None
    except (TypeError,ValueError): return None


def mapped_patient(hn, info=None, inpatient=None, vital=None):
    info, inpatient, vital = info or {}, inpatient or {}, vital or {}
    source={**inpatient,**info}
    first=text(pick(source,"FNAME","FIRST_NAME","FIRSTNAME")); last=text(pick(source,"LNAME","LAST_NAME","LASTNAME"))
    first_en=text(pick(source,"FNAME_E","FIRST_NAME_EN")); last_en=text(pick(source,"LNAME_E","LAST_NAME_EN"))
    name=text(pick(source,"PATIENT_NAME","PTNAME","NAME")) or " ".join(filter(None,(first,last))) or None
    return {"hn":hn,"an":text(pick(source,"AN")),"is_patient":text(pick(source,"IS_PATIENT")),
      "notype":text(pick(source,"NOTYPE")),"id_card":text(pick(source,"ID_CARD","CID","NATIONAL_ID")),
      "patient_name":name,"title_th":text(pick(source,"TITLE","TITLE_TH")),"title_en":text(pick(source,"TITLE_EN")),
      "first_name":first,"last_name":last,"first_name_en":first_en,"last_name_en":last_en,
      "sex":text(pick(source,"SEX","GENDER")),"dob":text(pick(source,"DOB","BIRTH_DATE")),
      "age_text":text(pick(source,"AGE","AGE_TEXT")),"weight_kg":numeric(pick(vital,"WEIGHT","WEIGHT_KG") or pick(source,"WEIGHT")),
      "height_cm":numeric(pick(vital,"HEIGHT","HEIGHT_CM") or pick(source,"HEIGHT")),
      "blood_group_text":text(pick(source,"BLOODGRP","BLOOD_GROUP")),"blood_group_abo":text(pick(source,"ABO")),
      "blood_group_rh":text(pick(source,"RH")),"race":text(pick(source,"RACE")),"ethnicity":text(pick(source,"ETHNICITY")),
      "religion":text(pick(source,"RELIGION")),"marital_status":text(pick(source,"MARITAL_STATUS")),
      "present_address":text(pick(source,"PRESENT_ADDRESS","ADDRESS")),"present_province":text(pick(source,"PRESENT_PROVINCE")),
      "legal_address":text(pick(source,"LEGAL_ADDRESS")),"legal_province":text(pick(source,"LEGAL_PROVINCE")),
      "mobile":text(pick(source,"MOBILE","TEL","PHONE")),"contact_name":text(pick(source,"CONTACT_NAME")),
      "contact_tel":text(pick(source,"CONTACT_TEL")),"relation_desc":text(pick(source,"RELATION_DESC")),
      "nationality":text(pick(source,"NATIONALITY")),"source":"HIS"}


def mapped_allergies(raw_rows, now):
    result=[]
    for raw in raw_rows:
        allergen=text(pick(raw,"NAME","ALLERGEN","SUBSTANCE","allergen_name"))
        if allergen: result.append({"allergen":allergen,"reaction":text(pick(raw,"RESULT_DIS","REACTION")),
          "severity":text(pick(raw,"CADR","SEVERITY")),"status":text(pick(raw,"STATUS")),"source":"HIS",
          "raw_payload":json.dumps(raw,ensure_ascii=False),"his_updated_at":now,"created_at":now,"updated_at":now})
    return result


def mapped_labs(raw_rows, now):
    result=[]
    for raw in raw_rows:
        name=text(pick(raw,"LABNAME","TEST_NAME","NAME"))
        if name: result.append({"test_name":name,"test_group":text(pick(raw,"LABGRPNAME","TEST_GROUP","GROUP_NAME")),
          "value_text":text(pick(raw,"LABRESULT","RESULT_VALUE","VALUE")),"unit":text(pick(raw,"LABUNIT","UNIT")),
          "ref_range":text(pick(raw,"LABMAXMIN","REF_RANGE")),"flag":text(pick(raw,"ABNORMALFLAG","FLAG")),
          "collected_at":None,"source":"HIS","raw_payload":json.dumps(raw,ensure_ascii=False),"his_updated_at":now,
          "created_at":now,"updated_at":now})
    return result


def insert_dict(database, table, values):
    keys=list(values); placeholders=",".join(["%s"]*len(keys))
    return database.execute(f"INSERT INTO {table} ({','.join(keys)}) VALUES ({placeholders}) RETURNING *",tuple(values[k] for k in keys)).fetchone()


def snapshot(database, hn):
    patient=database.execute("SELECT * FROM his_patient_buffer WHERE hn=%s",(hn,)).fetchone()
    if not patient: return None
    allergies=database.execute("SELECT id,allergen,reaction,severity,status,source,updated_at FROM his_allergy_buffer WHERE hn=%s ORDER BY id",(hn,)).fetchall()
    labs=database.execute("SELECT id,test_name,test_group,value_text,unit,ref_range,flag,collected_at,source,updated_at FROM his_lab_buffer WHERE hn=%s ORDER BY collected_at DESC NULLS LAST,id DESC",(hn,)).fetchall()
    try: payload=json.loads(patient["raw_payload"] or "{}")
    except ValueError: payload={}
    return {"row":patient,"allergies":allergies,"labs":labs,"his_payload":payload,"exchange":payload.get("_flora_exchange") if isinstance(payload,dict) else None}


def save_buffer(database, hn, patient, payload, allergies, labs, pre_admit_at=None, pre_admit_note=None):
    now=int(time.time()*1000); values={key:patient.get(key) for key in PATIENT_COLUMNS}
    values.update(source="DEMO_HIS" if isinstance(payload,dict) and payload.get("_flora_exchange") else "HIS",raw_payload=json.dumps(payload,ensure_ascii=False),pre_admit_at=pre_admit_at,
      pre_admit_note=pre_admit_note,his_updated_at=now,created_at=now,updated_at=now)
    keys=list(values)
    database.execute(f"""INSERT INTO his_patient_buffer({','.join(keys)}) VALUES ({','.join(['%s']*len(keys))})
      ON CONFLICT(hn) DO UPDATE SET {','.join(f'{key}=excluded.{key}' for key in keys if key not in {'hn','created_at'})}""",
      tuple(values[key] for key in keys))
    database.execute("DELETE FROM his_allergy_buffer WHERE hn=%s",(hn,)); database.execute("DELETE FROM his_lab_buffer WHERE hn=%s",(hn,))
    for item in allergies: insert_dict(database,"his_allergy_buffer",{"hn":hn,**item})
    for item in labs: insert_dict(database,"his_lab_buffer",{"hn":hn,**item})


def online_lookup(database, hn, labgrp="28", full=True, pre_admit_at=None, pre_admit_note=None):
    payload=find_demo_patient(hn,full) if DEMO_MODE else None
    if payload is None:
        payload=gateway("/api/patient-full" if full else "/api/patient-info",{"hn":hn,"labgrp":labgrp} if full else {"hn":hn})
    info=rows(payload.get("patientInfo") if isinstance(payload,dict) else payload)
    inpatient=rows(payload.get("inpatientAn") if isinstance(payload,dict) else None)
    vitals=rows(payload.get("vital") if isinstance(payload,dict) else None)
    patient=mapped_patient(hn,info[0] if info else {},inpatient[0] if inpatient else {},vitals[-1] if vitals else {})
    now=int(time.time()*1000)
    allergies=mapped_allergies(rows(payload.get("allergy") if isinstance(payload,dict) else None),now) if full else []
    labs=mapped_labs(rows(payload.get("lab") if isinstance(payload,dict) else None),now) if full else []
    with database.transaction(): save_buffer(database,hn,patient,payload,allergies,labs,pre_admit_at,pre_admit_note)
    snap=snapshot(database,hn)
    exchange=snap.get("exchange")
    return {"ok":True,"hn":hn,"source":"DEMO_HIS" if exchange else "HIS","offline":False,"row":snap["row"],"allergies":snap["allergies"],"labs":snap["labs"],"his_payload":payload,"exchange":exchange,"his_errors":payload.get("errors",{}) if isinstance(payload,dict) else {}}


@router.get("/his/demo-patients")
def list_demo_patients(_:dict=Depends(require_permission("case.create"))):
    return {"enabled":DEMO_MODE,"synthetic":True,"rows":demo_patient_catalog() if DEMO_MODE else []}


@router.post("/his/lookup")
def lookup(payload:dict=Body(...),_:dict=Depends(require_permission("case.create")),database:Connection=Depends(connection)):
    hn=text(payload.get("hn"));
    if not hn: raise HTTPException(400,"hn is required")
    try: return online_lookup(database,hn,text(payload.get("labgrp")) or "28")
    except RuntimeError as error:
        snap=snapshot(database,hn)
        if not snap: raise HTTPException(502,f"HIS gateway request failed: {error}")
        return {"ok":True,"hn":hn,"source":"BUFFER","offline":True,**snap,"his_errors":{"gateway":str(error)}}


@router.post("/his/patient-info-lookup")
def patient_lookup(payload:dict=Body(...),_:dict=Depends(require_permission("case.create")),database:Connection=Depends(connection)):
    hn=text(payload.get("hn"));
    if not hn: raise HTTPException(400,"hn is required")
    try: return online_lookup(database,hn,full=False)
    except RuntimeError as error: raise HTTPException(502,f"HIS gateway request failed: {error}")


@router.post("/his/preload")
def preload(payload:dict=Body(...),_:dict=Depends(require_permission("case.create")),database:Connection=Depends(connection)):
    hn=text(payload.get("hn"));
    if not hn: raise HTTPException(400,"hn is required")
    try: return online_lookup(database,hn,text(payload.get("labgrp")) or "28",True,payload.get("pre_admit_at"),text(payload.get("pre_admit_note")))
    except RuntimeError as error:
        if payload.get("allow_buffer_fallback",True) and (snap:=snapshot(database,hn)):
            return {"ok":True,"hn":hn,"source":"BUFFER","offline":True,**snap,"his_errors":{"gateway":str(error)}}
        raise HTTPException(502,f"HIS gateway request failed: {error}")


@router.get("/his/buffer")
def list_buffer(q:str="",limit:int=Query(80,ge=1,le=300),database:Connection=Depends(connection)):
    like=f"%{q.strip().lower()}%"
    result=database.execute("""SELECT p.hn,p.patient_name,p.first_name,p.last_name,p.first_name_en,p.last_name_en,p.sex,p.dob,
      p.blood_group_text,p.pre_admit_at,p.pre_admit_note,p.his_updated_at,p.updated_at,
      (SELECT count(*) FROM his_allergy_buffer a WHERE a.hn=p.hn) AS allergy_count,
      (SELECT count(*) FROM his_lab_buffer l WHERE l.hn=p.hn) AS lab_count FROM his_patient_buffer p
      WHERE (%s='' OR lower(coalesce(p.hn,'')) LIKE %s OR lower(coalesce(p.patient_name,'')) LIKE %s)
      ORDER BY p.pre_admit_at DESC NULLS LAST,p.his_updated_at DESC,p.hn LIMIT %s""",(q.strip(),like,like,limit)).fetchall()
    return {"rows":result}


@router.get("/his/buffer/{hn}")
def get_buffer(hn:str,database:Connection=Depends(connection)):
    snap=snapshot(database,hn)
    if not snap: raise HTTPException(404,"buffer patient not found")
    return {"ok":True,"hn":hn,"source":"BUFFER",**snap}


@router.delete("/his/buffer/{hn}")
def delete_buffer(hn:str,_:dict=Depends(require_permission("case.create")),database:Connection=Depends(connection)):
    with database.transaction():
        if not database.execute("DELETE FROM his_patient_buffer WHERE hn=%s RETURNING hn",(hn,)).fetchone(): raise HTTPException(404,"buffer patient not found")
        database.execute("DELETE FROM his_allergy_buffer WHERE hn=%s",(hn,)); database.execute("DELETE FROM his_lab_buffer WHERE hn=%s",(hn,))
    return {"ok":True,"hn":hn}


@router.post("/his/buffer/{hn}/pre-admit")
def pre_admit(hn:str,payload:dict=Body(...),_:dict=Depends(require_permission("case.create")),database:Connection=Depends(connection)):
    row=database.execute("UPDATE his_patient_buffer SET pre_admit_at=%s,pre_admit_note=%s,updated_at=%s WHERE hn=%s RETURNING hn,pre_admit_at,pre_admit_note",
      (payload.get("pre_admit_at"),text(payload.get("pre_admit_note")),int(time.time()*1000),hn)).fetchone()
    if not row: raise HTTPException(404,"buffer patient not found")
    return {"ok":True,**row}


def buffered_or_online_rows(database, hn, kind, payload):
    path="/api/patient-allergy" if kind=="allergy" else "/api/lab-result"
    try:
        raw=gateway(path,{"hn":hn,**({"labgrp":text(payload.get("labgrp")) or "28"} if kind=="lab" else {})}); now=int(time.time()*1000)
        mapped=mapped_allergies(rows(raw),now) if kind=="allergy" else mapped_labs(rows(raw),now)
        table=f"his_{kind}_buffer"
        with database.transaction():
            database.execute(f"DELETE FROM {table} WHERE hn=%s",(hn,))
            for item in mapped: insert_dict(database,table,{"hn":hn,**item})
        return "HIS",False,mapped,{}
    except RuntimeError as error:
        if not payload.get("allow_buffer_fallback",True): raise HTTPException(502,f"HIS gateway request failed: {error}")
        table=f"his_{kind}_buffer"; buffered=database.execute(f"SELECT * FROM {table} WHERE hn=%s ORDER BY id",(hn,)).fetchall()
        return "BUFFER",True,buffered,{"gateway":str(error)}


@router.post("/his/allergy")
def allergy_fetch(payload:dict=Body(...),_:dict=Depends(require_permission("case.create")),database:Connection=Depends(connection)):
    hn=text(payload.get("hn"));
    if not hn: raise HTTPException(400,"hn is required")
    source,offline,result,errors=buffered_or_online_rows(database,hn,"allergy",payload)
    return {"ok":True,"hn":hn,"source":source,"offline":offline,"rows":result,"his_errors":errors}


@router.post("/his/lab")
def lab_fetch(payload:dict=Body(...),_:dict=Depends(require_permission("case.create")),database:Connection=Depends(connection)):
    hn=text(payload.get("hn"));
    if not hn: raise HTTPException(400,"hn is required")
    source,offline,result,errors=buffered_or_online_rows(database,hn,"lab",payload)
    return {"ok":True,"hn":hn,"source":source,"offline":offline,"rows":result,"his_errors":errors}


def copy_snapshot_to_case(database,case_id,snap):
    now=int(time.time()*1000); patient={key:snap["row"].get(key) for key in PATIENT_COLUMNS}
    patient.update(case_id=case_id,source=snap["row"].get("source"),raw_payload=snap["row"].get("raw_payload"),his_updated_at=snap["row"].get("his_updated_at"),created_at=now,updated_at=now)
    keys=list(patient); database.execute(f"""INSERT INTO case_his_patient({','.join(keys)}) VALUES ({','.join(['%s']*len(keys))})
      ON CONFLICT(case_id) DO UPDATE SET {','.join(f'{key}=excluded.{key}' for key in keys if key not in {'case_id','created_at'})}""",tuple(patient[k] for k in keys))
    database.execute("DELETE FROM case_his_allergy WHERE case_id=%s",(case_id,)); database.execute("DELETE FROM case_his_lab WHERE case_id=%s",(case_id,))
    for item in snap["allergies"]: insert_dict(database,"case_his_allergy",{"case_id":case_id,**{k:item.get(k) for k in ("allergen","reaction","severity","status","source","raw_payload","his_updated_at","created_at","updated_at")}})
    for item in snap["labs"]: insert_dict(database,"case_his_lab",{"case_id":case_id,**{k:item.get(k) for k in ("test_name","test_group","value_text","unit","ref_range","flag","collected_at","source","raw_payload","his_updated_at","created_at","updated_at")}})


@router.post("/{case_id}/his/sync")
def sync_all(case_id:int,payload:dict=Body(default={}),actor:dict=Depends(require_permission("case.chart")),database:Connection=Depends(connection)):
    case=editable_case(database,case_id); result=lookup({"hn":case["hn"],**payload},actor,database)
    snap=snapshot(database,case["hn"])
    with database.transaction(): copy_snapshot_to_case(database,case_id,snap)
    return {"ok":True,"case_id":case_id,"hn":case["hn"],**{k:result.get(k) for k in ("source","offline","his_errors")},"row":snap["row"],"allergies":snap["allergies"],"labs":snap["labs"]}


@router.post("/{case_id}/his/patient-info-sync")
def sync_patient(case_id:int,payload:dict=Body(default={}),_:dict=Depends(require_permission("case.chart")),database:Connection=Depends(connection)):
    case=editable_case(database,case_id); online_lookup(database,case["hn"],full=False); snap=snapshot(database,case["hn"])
    with database.transaction(): copy_snapshot_to_case(database,case_id,{**snap,"allergies":[],"labs":[]})
    return {"ok":True,"case_id":case_id,"hn":case["hn"],"source":"HIS","offline":False,"row":snap["row"],"allergies":[],"labs":[]}


@router.post("/{case_id}/his/allergy/sync")
def sync_allergy(case_id:int,payload:dict=Body(default={}),_:dict=Depends(require_permission("case.chart")),database:Connection=Depends(connection)):
    case=editable_case(database,case_id); source,offline,result,errors=buffered_or_online_rows(database,case["hn"],"allergy",payload)
    with database.transaction():
        database.execute("DELETE FROM case_his_allergy WHERE case_id=%s",(case_id,))
        for item in result: insert_dict(database,"case_his_allergy",{"case_id":case_id,**{k:item.get(k) for k in ("allergen","reaction","severity","status","source","raw_payload","his_updated_at","created_at","updated_at")}})
    return {"ok":True,"case_id":case_id,"hn":case["hn"],"source":source,"offline":offline,"rows":result,"his_errors":errors}

@router.post("/{case_id}/his/lab/sync")
def sync_lab(case_id:int,payload:dict=Body(default={}),_:dict=Depends(require_permission("case.chart")),database:Connection=Depends(connection)):
    case=editable_case(database,case_id); source,offline,result,errors=buffered_or_online_rows(database,case["hn"],"lab",payload)
    with database.transaction():
        database.execute("DELETE FROM case_his_lab WHERE case_id=%s",(case_id,))
        for item in result: insert_dict(database,"case_his_lab",{"case_id":case_id,**{k:item.get(k) for k in ("test_name","test_group","value_text","unit","ref_range","flag","collected_at","source","raw_payload","his_updated_at","created_at","updated_at")}})
    return {"ok":True,"case_id":case_id,"hn":case["hn"],"source":source,"offline":offline,"rows":result,"his_errors":errors}
