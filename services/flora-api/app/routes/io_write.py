import re

from fastapi import APIRouter, Body, Depends, HTTPException
from psycopg import Connection

from ..clinical import flag, insert, io_audit, number, text, timestamp, update
from ..database import connection
from .auth_leaf import now_ms, require_permission
from .cases_lifecycle import editable_case

router=APIRouter(prefix="/api/case",tags=["I/O entry"])


def item(db,item_id):
    row=db.execute("SELECT * FROM io_item_master WHERE id=%s",(item_id,)).fetchone()
    if not row: raise HTTPException(400,"invalid item_id")
    return row


def run_row(db,run_id):
    return db.execute("""SELECT r.*,i.code AS item_code,i.name AS item_name,i.category AS item_category,i.default_unit AS item_unit
      FROM case_io_run r JOIN io_item_master i ON i.id=r.item_id WHERE r.id=%s""",(run_id,)).fetchone()


def event_row(db,event_id):
    return db.execute("""SELECT e.*,i.code AS item_code,i.name AS item_name,i.category AS item_category
      FROM case_io_event e JOIN io_item_master i ON i.id=e.item_id WHERE e.id=%s""",(event_id,)).fetchone()


def run_values(payload,master,old=None):
    old=old or {}
    kind=payload.get("kind",old.get("kind",master["kind"]))
    if kind not in {"med","fluid","output"} or kind!=master["kind"]: raise HTTPException(400,"kind does not match item")
    mode=payload.get("entry_mode",old.get("entry_mode","bolus"))
    if mode not in {"bolus","drip"}: raise HTTPException(400,"invalid entry_mode")
    started=timestamp(payload.get("started_at",old.get("started_at")),"started_at",now_ms()//60000*60000)
    stopped=timestamp(payload.get("stopped_at",old.get("stopped_at")),"stopped_at")
    if stopped is not None and stopped<started: raise HTTPException(400,"stopped_at must be >= started_at")
    return dict(item_id=master["id"],kind=kind,route=text(payload.get("route",old.get("route"))),started_at=started,stopped_at=stopped,
      entry_mode=mode,note=text(payload.get("note",old.get("note"))),include_in_balance=flag(payload.get("include_in_balance",old.get("include_in_balance",1))),updated_at=now_ms())


def segment_values(payload,old=None):
    old=old or {}; start=timestamp(payload.get("ts_from",old.get("ts_from")),"ts_from")
    if start is None: raise HTTPException(400,"ts_from required")
    end=timestamp(payload.get("ts_to",old.get("ts_to")),"ts_to")
    if end is not None and end<start: raise HTTPException(400,"ts_to must be >= ts_from")
    rate=number(payload.get("rate_value",old.get("rate_value")),"rate_value",0)
    dose=number(payload.get("dose_value",old.get("dose_value")),"dose_value",0)
    carrier=number(payload.get("carrier_ml_per_hr",old.get("carrier_ml_per_hr")),"carrier_ml_per_hr",0)
    if rate is None and dose is None and carrier is None: raise HTTPException(400,"rate, dose, or carrier required")
    return dict(ts_from=start,ts_to=end,rate_value=rate,rate_unit=text(payload.get("rate_unit",old.get("rate_unit"))),dose_value=dose,
      dose_unit=text(payload.get("dose_unit",old.get("dose_unit"))),carrier_ml_per_hr=carrier,
      include_in_balance=flag(payload.get("include_in_balance",old.get("include_in_balance",1))),note=text(payload.get("note",old.get("note"))),updated_at=now_ms())


@router.post("/{case_id}/io/runs")
def create_run(case_id:int,payload:dict=Body(...),actor:dict=Depends(require_permission("case.chart")),database:Connection=Depends(connection)):
    with database.transaction():
        editable_case(database,case_id); master=item(database,int(payload.get("item_id") or 0)); values=run_values(payload,master)
        row=insert(database,"case_io_run",dict(case_id=case_id,**values,created_by=actor["username"],created_at=now_ms()))
        result=run_row(database,row["id"]); io_audit(database,case_id,"run",None,result,actor,payload.get("reason"))
    return {"ok":True,"row":result}


@router.put("/{case_id}/io/runs/{run_id}")
def edit_run(case_id:int,run_id:int,payload:dict=Body(...),actor:dict=Depends(require_permission("case.chart")),database:Connection=Depends(connection)):
    with database.transaction():
        editable_case(database,case_id); old=run_row(database,run_id)
        if not old or old["case_id"]!=case_id: raise HTTPException(404,"run not found")
        master=item(database,int(payload.get("item_id",old["item_id"]))); update(database,"case_io_run",run_id,run_values(payload,master,old))
        result=run_row(database,run_id); io_audit(database,case_id,"run",old,result,actor,payload.get("reason"))
    return {"ok":True,"row":result}


@router.post("/{case_id}/io/segments")
def create_segment(case_id:int,payload:dict=Body(...),actor:dict=Depends(require_permission("case.chart")),database:Connection=Depends(connection)):
    run_id=int(payload.get("run_id") or 0)
    with database.transaction():
        editable_case(database,case_id); run=run_row(database,run_id)
        if not run or run["case_id"]!=case_id: raise HTTPException(404,"run not found")
        row=insert(database,"case_io_segment",dict(run_id=run_id,**segment_values(payload),created_by=actor["username"],created_at=now_ms()))
        io_audit(database,case_id,"segment",None,row,actor,payload.get("reason"))
    return {"ok":True,"row":row}


@router.put("/{case_id}/io/segments/{segment_id}")
def edit_segment(case_id:int,segment_id:int,payload:dict=Body(...),actor:dict=Depends(require_permission("case.chart")),database:Connection=Depends(connection)):
    with database.transaction():
        editable_case(database,case_id)
        old=database.execute("SELECT s.* FROM case_io_segment s JOIN case_io_run r ON r.id=s.run_id WHERE s.id=%s AND r.case_id=%s",(segment_id,case_id)).fetchone()
        if not old: raise HTTPException(404,"segment not found")
        row=update(database,"case_io_segment",segment_id,segment_values(payload,old)); io_audit(database,case_id,"segment",old,row,actor,payload.get("reason"))
    return {"ok":True,"row":row}


def create_event_internal(db,case_id,payload,actor):
    master=item(db,int(payload.get("item_id") or 0)); kind=payload.get("kind") or master["kind"]
    if kind!=master["kind"]: raise HTTPException(400,"kind does not match item")
    event_ts=timestamp(payload.get("event_ts"),"event_ts",now_ms()//60000*60000)
    volume=number(payload.get("volume_ml"),"volume_ml",0); dose=number(payload.get("dose_value"),"dose_value",0)
    include=flag(payload.get("include_in_balance",True))
    if include and kind in {"fluid","output"} and volume is None: raise HTTPException(400,"volume_ml required for fluid/output balance")
    route=text(payload.get("route")) or "IV"
    existing=db.execute("SELECT id FROM case_io_run WHERE case_id=%s AND item_id=%s AND kind=%s AND entry_mode='bolus' AND include_in_balance<>0 ORDER BY id LIMIT 1",(case_id,master["id"],kind)).fetchone()
    if not existing:
        run=insert(db,"case_io_run",dict(case_id=case_id,item_id=master["id"],kind=kind,route=route,started_at=event_ts,stopped_at=None,entry_mode="bolus",note=None,include_in_balance=include,created_by=actor["username"],created_at=now_ms(),updated_at=now_ms()))
        io_audit(db,case_id,"run",None,run,actor,"bolus row created")
    row=insert(db,"case_io_event",dict(case_id=case_id,item_id=master["id"],kind=kind,event_ts=event_ts,volume_ml=volume,dose_value=dose,
      dose_unit=text(payload.get("dose_unit")),note=text(payload.get("note")),include_in_balance=include,created_by=actor["username"],created_at=now_ms(),updated_at=now_ms()))
    result=event_row(db,row["id"]); io_audit(db,case_id,"event",None,result,actor,payload.get("reason"))
    auto={"ivanesth":"Induction","ivanesthetic":"Induction","antibiotics":"SSI Prophylaxis","antimicrobial":"SSI Prophylaxis","reversal":"Reversal"}.get(re.sub(r"[^a-z0-9]","",str(master.get("category") or "").lower()))
    if auto and not db.execute("SELECT 1 FROM case_event_note WHERE case_id=%s AND is_deleted=0 AND event_type='event' AND lower(title)=lower(%s)",(case_id,auto)).fetchone():
        insert(db,"case_event_note",dict(case_id=case_id,event_ts=event_ts,event_type="event",title=auto,detail=None,created_by=actor["username"],created_at=now_ms(),updated_by=actor["username"],updated_at=now_ms(),is_deleted=0))
    return result


@router.post("/{case_id}/io/events")
def create_event(case_id:int,payload:dict=Body(...),actor:dict=Depends(require_permission("case.chart")),database:Connection=Depends(connection)):
    with database.transaction(): editable_case(database,case_id); row=create_event_internal(database,case_id,payload,actor)
    return {"ok":True,"row":row}


@router.delete("/{case_id}/io/events/{event_id}")
def delete_event(case_id:int,event_id:int,payload:dict=Body(default={}),actor:dict=Depends(require_permission("case.chart")),database:Connection=Depends(connection)):
    with database.transaction():
        editable_case(database,case_id); old=event_row(database,event_id)
        if not old or old["case_id"]!=case_id: raise HTTPException(404,"event not found")
        database.execute("DELETE FROM case_io_event WHERE id=%s",(event_id,)); io_audit(database,case_id,"event",old,None,actor,payload.get("reason"))
    return {"ok":True,"deleted":1}


@router.post("/{case_id}/io/drips")
def create_drip(case_id:int,payload:dict=Body(...),actor:dict=Depends(require_permission("case.chart")),database:Connection=Depends(connection)):
    run_payload=payload.get("run"); segment_payload=payload.get("segment")
    if not isinstance(run_payload,dict) or not isinstance(segment_payload,dict): raise HTTPException(400,"run and segment objects required")
    with database.transaction():
        editable_case(database,case_id); master=item(database,int(run_payload.get("item_id") or 0)); run_payload={**run_payload,"entry_mode":"drip"}
        run=insert(database,"case_io_run",dict(case_id=case_id,**run_values(run_payload,master),created_by=actor["username"],created_at=now_ms()))
        full_run=run_row(database,run["id"]); io_audit(database,case_id,"run",None,full_run,actor,payload.get("reason"))
        segment=insert(database,"case_io_segment",dict(run_id=run["id"],**segment_values(segment_payload),created_by=actor["username"],created_at=now_ms()))
        io_audit(database,case_id,"segment",None,segment,actor,payload.get("reason"))
    return {"ok":True,"run":full_run,"segment":segment}


@router.put("/{case_id}/io/runs/{run_id}/drip")
def replace_drip(case_id:int,run_id:int,payload:dict=Body(...),actor:dict=Depends(require_permission("case.chart")),database:Connection=Depends(connection)):
    run_payload=payload.get("run"); segment_payload=payload.get("segment")
    if not isinstance(run_payload,dict) or not isinstance(segment_payload,dict): raise HTTPException(400,"run and segment objects required")
    with database.transaction():
        editable_case(database,case_id); old=run_row(database,run_id)
        if not old or old["case_id"]!=case_id: raise HTTPException(404,"run not found")
        master=item(database,int(run_payload.get("item_id",old["item_id"]))); update(database,"case_io_run",run_id,run_values({**run_payload,"entry_mode":"drip","stopped_at":None},master,old))
        result=run_row(database,run_id); io_audit(database,case_id,"run",old,result,actor,payload.get("reason"))
        old_segments=database.execute("DELETE FROM case_io_segment WHERE run_id=%s RETURNING *",(run_id,)).fetchall()
        for segment in old_segments: io_audit(database,case_id,"segment",segment,None,actor,payload.get("reason"))
        segment=insert(database,"case_io_segment",dict(run_id=run_id,**segment_values({**segment_payload,"ts_to":None}),created_by=actor["username"],created_at=now_ms()))
        io_audit(database,case_id,"segment",None,segment,actor,payload.get("reason"))
    return {"ok":True,"run":result,"segment":segment}


@router.post("/{case_id}/io/blood-products")
def blood_product(case_id:int,payload:dict=Body(...),actor:dict=Depends(require_permission("case.chart")),database:Connection=Depends(connection)):
    run_payload=payload.get("run"); event_payload=payload.get("event")
    if not isinstance(run_payload,dict) or not isinstance(event_payload,dict): raise HTTPException(400,"run and event objects required")
    merged={**event_payload,"item_id":run_payload.get("item_id"),"kind":"fluid","route":run_payload.get("route"),"note":event_payload.get("note") or run_payload.get("note"),"reason":payload.get("reason")}
    with database.transaction():
        editable_case(database,case_id); event=create_event_internal(database,case_id,merged,actor)
        run=run_row(database,database.execute("SELECT id FROM case_io_run WHERE case_id=%s AND item_id=%s AND entry_mode='bolus' ORDER BY id LIMIT 1",(case_id,merged["item_id"])).fetchone()["id"])
    return {"ok":True,"run":run,"event":event}


@router.post("/{case_id}/io/runs/{run_id}/discontinue")
def discontinue(case_id:int,run_id:int,payload:dict=Body(default={}),actor:dict=Depends(require_permission("case.chart")),database:Connection=Depends(connection)):
    with database.transaction():
        editable_case(database,case_id); current=run_row(database,run_id)
        if not current or current["case_id"]!=case_id: raise HTTPException(404,"run not found")
        stopped=max(current["started_at"],timestamp(payload.get("stopped_at"),"stopped_at",now_ms()//60000*60000))
        related=database.execute("SELECT * FROM case_io_run WHERE case_id=%s AND item_id=%s AND kind=%s AND coalesce(entry_mode,'')=coalesce(%s,'') AND include_in_balance=1",(case_id,current["item_id"],current["kind"],current["entry_mode"])).fetchall()
        for old in related:
            after=update(database,"case_io_run",old["id"],{"stopped_at":max(old["started_at"],stopped),"include_in_balance":0,"updated_at":now_ms()}); io_audit(database,case_id,"run",old,after,actor,payload.get("reason") or "io run discontinue")
        events=[]
        if current["entry_mode"]=="bolus": events=database.execute("SELECT * FROM case_io_event WHERE case_id=%s AND item_id=%s AND kind=%s AND include_in_balance=1",(case_id,current["item_id"],current["kind"])).fetchall()
        for old in events:
            after=update(database,"case_io_event",old["id"],{"include_in_balance":0,"updated_at":now_ms()}); io_audit(database,case_id,"event",old,after,actor,payload.get("reason") or "io run discontinue")
    return {"ok":True,"run":run_row(database,run_id),"discontinued_at":stopped,"excluded_runs":len(related),"excluded_events":len(events)}
