import json
import re
from typing import Any
from fastapi import APIRouter, Body, Depends, HTTPException
from psycopg import Connection, sql
from ..database import connection
from ..clinical import insert,update,text,number,timestamp,case_audit
from .auth_leaf import current_user,now_ms
from .cases_lifecycle import editable_case

router=APIRouter(prefix="/api/case",tags=["clinical entry"])


@router.put("/{case_id}/patient")
def patient(case_id:int,payload:dict=Body(...),actor:dict=Depends(current_user),database:Connection=Depends(connection)):
    hn=text(payload.get("hn"))
    if not hn: raise HTTPException(400,"hn is required")
    with database.transaction():
        before=database.execute("SELECT * FROM cases WHERE id=%s FOR UPDATE",(case_id,)).fetchone()
        if not before: raise HTTPException(404,"case not found")
        now=now_ms()
        update(database,"cases",case_id,{"hn":hn,"updated_at":now})
        database.execute("UPDATE case_his_patient SET hn=%s,updated_at=%s WHERE case_id=%s",(hn,now,case_id))
        case_audit(database,case_id,"patient.hn",{"hn":before["hn"]},{"hn":hn},actor)
    return {"ok":True,"row":{"case_id":case_id,"hn":hn,"previous_hn":before["hn"],"updated_at":now}}


def save_draft(db,case_id,draft,actor):
    with db.transaction():
        editable_case(db,case_id)
        old=db.execute("SELECT form_draft_json FROM case_detail WHERE case_id=%s",(case_id,)).fetchone()
        now=now_ms()
        db.execute("""INSERT INTO case_detail(case_id,created_at,updated_at,form_draft_json) VALUES (%s,%s,%s,%s)
            ON CONFLICT(case_id) DO UPDATE SET updated_at=excluded.updated_at,form_draft_json=excluded.form_draft_json""",
            (case_id,now,now,json.dumps(draft) if draft is not None else None))
        case_audit(db,case_id,"form.draft",old,draft,actor)
    return {"ok":True,"case_id":case_id,"updated_at":now}


@router.put("/{case_id}/detail-draft")
def draft(case_id:int,payload:dict=Body(...),actor:dict=Depends(current_user),database:Connection=Depends(connection)):
    if not isinstance(payload.get("draft"),dict): raise HTTPException(400,"draft object required")
    return save_draft(database,case_id,payload["draft"],actor)


@router.delete("/{case_id}/detail-draft")
def clear_draft(case_id:int,actor:dict=Depends(current_user),database:Connection=Depends(connection)):
    return save_draft(database,case_id,None,actor)


def register_context_routes(path,table,required):
    def values(db,payload,old=None):
        old=old or {}
        name=text(payload.get(required,old.get(required)))
        if not name: raise HTTPException(400,f"{required} required")
        if path=="allergies":
            return {required:name,**{k:text(payload.get(k,old.get(k))) for k in ("reaction","severity")},
                "status":text(payload.get("status",old.get("status"))) or "active",
                "updated_at":now_ms(),"his_updated_at":now_ms()}
        code=text(payload.get("icd_code",old.get("icd_code")))
        code=re.sub(r"\s+","",code).upper() if code else None
        version=text(payload.get("icd_version",old.get("icd_version"))) or ("ICD-10" if path=="diagnosis" else "ICD-9") if code else text(payload.get("icd_version",old.get("icd_version")))
        label=text(payload.get("icd_text",old.get("icd_text")))
        if code and version=="ICD-10":
            found=db.execute("SELECT coalesce(nullif(name_en,''),name_th) AS name FROM icd10_master WHERE icd10=%s OR icd10who=%s LIMIT 1",(code,code)).fetchone()
            if found: label=found["name"] or label
        elif code and version=="ICD-9":
            code=code.replace(".","")
            found=db.execute("SELECT name_en AS name FROM icd9cm_master WHERE icd9cm=%s LIMIT 1",(code,)).fetchone()
            if found: label=found["name"] or label
        seq=number(payload.get("seq",old.get("seq",1)),"seq",1)
        return {required:name,"icd_code":code,"icd_version":version,"icd_text":label,"seq":int(seq or 1)}

    def create(case_id:int,payload:dict=Body(...),actor:dict=Depends(current_user),database:Connection=Depends(connection)):
        with database.transaction():
            editable_case(database,case_id)
            data={"case_id":case_id,**values(database,payload),"created_at":now_ms()}
            if path=="allergies": data["source"]="MANUAL"
            row=insert(database,table,data)
            case_audit(database,case_id,path+".insert",None,row,actor)
        return {"ok":True,"id":row["id"],"row":row}

    def edit(case_id:int,entry_id:int,payload:dict=Body(...),actor:dict=Depends(current_user),database:Connection=Depends(connection)):
        with database.transaction():
            editable_case(database,case_id)
            old=database.execute(sql.SQL("SELECT * FROM {} WHERE id=%s AND case_id=%s").format(sql.Identifier(table)),(entry_id,case_id)).fetchone()
            if not old: raise HTTPException(404,f"{path} not found")
            row=update(database,table,entry_id,values(database,payload,old))
            case_audit(database,case_id,path+".update",old,row,actor)
        return {"ok":True,"row":row}

    def delete(case_id:int,entry_id:int,actor:dict=Depends(current_user),database:Connection=Depends(connection)):
        with database.transaction():
            editable_case(database,case_id)
            old=database.execute(sql.SQL("DELETE FROM {} WHERE id=%s AND case_id=%s RETURNING *").format(sql.Identifier(table)),(entry_id,case_id)).fetchone()
            if not old: raise HTTPException(404,f"{path} not found")
            case_audit(database,case_id,path+".delete",old,None,actor)
        return {"ok":True}

    router.add_api_route("/{case_id}/"+path,create,methods=["POST"],name=path+"_create")
    router.add_api_route("/{case_id}/"+path+"/{entry_id}",edit,methods=["PUT"],name=path+"_edit")
    router.add_api_route("/{case_id}/"+path+"/{entry_id}",delete,methods=["DELETE"],name=path+"_delete")


register_context_routes("diagnosis","case_diagnosis","diagnosis_text")
register_context_routes("procedures","case_procedure","procedure_text")
register_context_routes("allergies","case_his_allergy","allergen")

ALIASES={
    "ane":({"start ane","start anes","start anesthesia","start anaesthesia","sa"},{"end ane","end anes","end anesthesia","end anaesthesia","ea"}),
    "surg":({"start surg","start surgery","ss"},{"end surg","end surgery","es"}),
}


def lifecycle(title):
    title=" ".join(title.lower().split())
    for scope,(starts,ends) in ALIASES.items():
        if title in starts: return scope,"start"
        if title in ends: return scope,"end"
    return None


def event_audit(db,case_id,old,row,actor,reason=None):
    keys=("event_ts","event_type","title","detail")
    values={"case_id":case_id,"event_note_id":(row or old)["id"],"action":"delete" if row is None else "update" if old else "insert"}
    values.update({"old_"+key:old.get(key) if old else None for key in keys})
    values.update({"new_"+key:row.get(key) if row else None for key in keys})
    values.update(reason=text(reason),actor_username=actor["username"],actor_name=actor.get("name"),actor_role=actor.get("role"),created_at=now_ms())
    insert(db,"case_event_note_audit",values)


def write_event(db,case_id,payload,actor,old=None):
    previous=old or {}
    title=text(payload.get("title",previous.get("title")))
    if not title: raise HTTPException(400,"title required")
    ts=number(payload.get("event_ts",previous.get("event_ts",now_ms())),"event_ts",1)
    if ts is None: raise HTTPException(400,"event_ts required")
    kind="note" if payload.get("event_type",previous.get("event_type"))=="note" else "event"
    parsed=lifecycle(title) if kind=="event" else None
    if parsed:
        scope,phase=parsed
        rows=db.execute("SELECT title,event_ts FROM case_event_note WHERE case_id=%s AND is_deleted=0 AND event_type='event' AND id<>%s ORDER BY event_ts,id",(case_id,previous.get("id",-1))).fetchall()
        starts=0
        opened=0
        for item in rows:
            event=lifecycle(item["title"])
            if not event or event[0]!=scope: continue
            if event[1]=="start": starts+=1
            if item["event_ts"]<=ts: opened=opened+1 if event[1]=="start" else max(0,opened-1)
        label="ANE" if scope=="ane" else "Surgery"
        if phase=="start" and starts: raise HTTPException(400,f"Start {label} already recorded in this case")
        if phase=="end" and opened<=0: raise HTTPException(400,f"Need Start {label} before End {label}")
    values=dict(event_ts=int(ts),event_type=kind,title=title,detail=text(payload.get("detail",previous.get("detail"))),updated_by=actor["username"],updated_at=now_ms())
    if old: row=update(db,"case_event_note",old["id"],values)
    else: row=insert(db,"case_event_note",dict(case_id=case_id,**values,created_by=actor["username"],created_at=now_ms(),is_deleted=0))
    event_audit(db,case_id,old,row,actor,payload.get("reason"))
    return row


@router.post("/{case_id}/events")
def create_event(case_id:int,payload:dict=Body(...),actor:dict=Depends(current_user),database:Connection=Depends(connection)):
    with database.transaction():
        editable_case(database,case_id)
        row=write_event(database,case_id,payload,actor)
    return {"ok":True,**row}


@router.put("/{case_id}/events/{event_id}")
def edit_event(case_id:int,event_id:int,payload:dict=Body(...),actor:dict=Depends(current_user),database:Connection=Depends(connection)):
    with database.transaction():
        editable_case(database,case_id)
        old=database.execute("SELECT * FROM case_event_note WHERE id=%s AND case_id=%s AND is_deleted=0",(event_id,case_id)).fetchone()
        if not old: raise HTTPException(404,"event not found")
        write_event(database,case_id,payload,actor,old)
    return {"ok":True,"updated":1}


@router.delete("/{case_id}/events/{event_id}")
def delete_event(case_id:int,event_id:int,payload:dict=Body(default={}),actor:dict=Depends(current_user),database:Connection=Depends(connection)):
    with database.transaction():
        editable_case(database,case_id)
        old=database.execute("SELECT * FROM case_event_note WHERE id=%s AND case_id=%s AND is_deleted=0",(event_id,case_id)).fetchone()
        if not old: raise HTTPException(404,"event not found")
        update(database,"case_event_note",event_id,{"is_deleted":1,"updated_by":actor["username"],"updated_at":now_ms()})
        event_audit(database,case_id,old,None,actor,payload.get("reason"))
    return {"ok":True,"deleted":1}


@router.put("/{case_id}/timeline")
def timeline(case_id:int,payload:dict=Body(...),actor:dict=Depends(current_user),database:Connection=Depends(connection)):
    changes=payload.get("changes")
    if not isinstance(changes,list) or not changes: raise HTTPException(400,"changes required")
    counts=dict(inserted=0,updated=0,deleted=0,skipped=0)
    with database.transaction():
        editable_case(database,case_id)
        for item in changes:
            ts=timestamp(item.get("ts_minute"),"ts_minute")
            key=(text(item.get("param_key")) or "").lower()
            if ts is None or not key: raise HTTPException(400,"ts_minute and param_key required")
            old=database.execute("SELECT * FROM case_timeline_value WHERE case_id=%s AND ts_minute=%s AND param_key=%s",(case_id,ts,key)).fetchone()
            delete=item.get("action")=="delete" or item.get("value") in (None,"")
            if delete and not old:
                counts["skipped"]+=1
                continue
            previous=old or {}
            if delete:
                database.execute("DELETE FROM case_timeline_value WHERE id=%s",(old["id"],))
                after=None
                action="delete"
            else:
                value=item["value"]
                numeric=item.get("value_type")=="number" or isinstance(value,(int,float))
                data=dict(value_type="number" if numeric else item.get("value_type") if item.get("value_type") in ("text","code") else "code" if key=="ecg" else "text",
                    value_num=number(value,key) if numeric else None,value_text=None if numeric else text(value),
                    unit=text(item.get("unit")) or previous.get("unit"),note=text(item.get("note",previous.get("note"))),
                    source="override" if item.get("source",previous.get("source"))=="override" else "manual")
                if old and all(old[k]==v for k,v in data.items()):
                    counts["skipped"]+=1
                    continue
                data.update(updated_by=actor["username"],updated_at=now_ms())
                after=update(database,"case_timeline_value",old["id"],data) if old else insert(database,"case_timeline_value",dict(case_id=case_id,ts_minute=ts,param_key=key,**data,created_by=actor["username"],created_at=now_ms()))
                action="update" if old else "insert"
            audit=dict(case_id=case_id,ts_minute=ts,param_key=key,action=action)
            for field in ("value_num","value_text","value_type"):
                audit["old_"+field]=previous.get(field)
                audit["new_"+field]=after.get(field) if after else None
            audit.update({k:(after or old).get(k) for k in ("unit","source","note")})
            audit.update(reason=text(payload.get("reason")),actor_username=actor["username"],actor_name=actor.get("name"),actor_role=actor.get("role"),created_at=now_ms())
            insert(database,"case_timeline_audit",audit)
            counts[{"insert":"inserted","update":"updated","delete":"deleted"}[action]]+=1
    return {"ok":True,**counts}
