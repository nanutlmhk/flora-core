import re
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from psycopg import Connection

from ..clinical import flag, insert, number, text, update, case_audit
from ..database import connection
from .auth_leaf import current_user, now_ms
from .cases_lifecycle import editable_case

router = APIRouter(prefix="/api/case", tags=["clinical catalogs"])


@router.get("/icd10/search")
def icd10_search(q: str = "", limit: int = Query(40, ge=1, le=200), database: Connection = Depends(connection)):
    query = q.strip()
    if not query:
        return {"query": "", "rows": []}
    compact = re.sub(r"\s+", "", query.upper())
    pattern = f"%{query}%"
    rows = database.execute(
        """SELECT icd10,icd10who,name_en,name_th,short_name_en,short_name_th,
          CASE WHEN icd10=%s OR icd10who=%s THEN 1000
               WHEN icd10 ILIKE %s OR icd10who ILIKE %s THEN 900
               WHEN coalesce(name_en,'') ILIKE %s OR coalesce(name_th,'') ILIKE %s THEN 700 ELSE 0 END AS score
          FROM icd10_master
          WHERE icd10 ILIKE %s OR icd10who ILIKE %s OR coalesce(name_en,'') ILIKE %s OR coalesce(name_th,'') ILIKE %s
          ORDER BY score DESC,icd10 LIMIT %s""",
        (compact, compact, compact+"%", compact+"%", pattern, pattern,
         compact+"%", compact+"%", pattern, pattern, limit),
    ).fetchall()
    return {"query": query, "rows": rows}


@router.get("/icd9/search")
def icd9_search(q: str = "", limit: int = Query(20, ge=1, le=50), database: Connection = Depends(connection)):
    query = q.strip()
    if not query:
        return {"query": query, "rows": []}
    code = re.sub(r"[\s.]", "", query)
    like = f"%{query}%"
    rows = database.execute(
        """SELECT icd9cm,short_name_en,name_en,
          CASE WHEN icd9cm=%s THEN 1000 WHEN icd9cm LIKE %s THEN 920
               WHEN coalesce(name_en,'') ILIKE %s THEN 820 ELSE 0 END AS score
          FROM icd9cm_master WHERE icd9cm LIKE %s OR coalesce(name_en,'') ILIKE %s OR coalesce(short_name_en,'') ILIKE %s
          ORDER BY score DESC,icd9cm LIMIT %s""",
        (code,code+"%",like,code+"%",like,like,limit),
    ).fetchall()
    return {"query": query, "rows": rows}


def role(db: Connection, role_id, label=None):
    role_id=text(role_id)
    row=db.execute("SELECT id,display_name FROM staff_role WHERE id=%s",(role_id,)).fetchone() if role_id else None
    if not row and label:
        row=db.execute("SELECT id,display_name FROM staff_role WHERE lower(display_name)=lower(%s)",(text(label),)).fetchone()
    if not row:
        raise HTTPException(400,"valid staff role required")
    return row["id"],row["display_name"]


def staff_values(db,payload,old=None):
    source=payload.get("staff") if isinstance(payload.get("staff"),dict) else payload
    old=old or {}
    role_id,role_label=role(db,source.get("role_id",source.get("staff_role_id",old.get("staff_role_id"))),source.get("role",old.get("staff_role")))
    values={k:text(source.get(k,old.get(k))) for k in ("hospital_id","personal_id","email","th_first_name","th_last_name","en_first_name","en_last_name","innovian_id")}
    values["email"]=(values["email"] or "").lower() or None
    values["staff_role_id"]=role_id
    values["staff_role"]=role_label
    values["staff_name"]=text(source.get("name",source.get("staff_name",old.get("staff_name")))) or " ".join(filter(None,(values["en_first_name"],values["en_last_name"])))
    if not values["staff_name"]:
        raise HTTPException(400,"staff name required")
    entry=number(source.get("entry_year",old.get("entry_year")),"entry_year",1900)
    values["entry_year"]=int(entry) if entry else None
    return values


@router.get("/staff/directory")
def staff_directory(q:str="",role_id:str="",include_inactive:bool=False,limit:int=Query(200,ge=1,le=500),database:Connection=Depends(connection)):
    like=f"%{q.strip()}%"
    rows=database.execute("""SELECT id,hospital_id,personal_id,email,th_first_name,th_last_name,en_first_name,en_last_name,
      innovian_id,staff_role_id AS role_id,staff_name AS name,staff_role AS role,entry_year,is_active,used_count,last_used_at,created_at,updated_at
      FROM staff_directory WHERE (%s OR is_active=1) AND (%s='' OR staff_role_id=%s)
      AND (%s='' OR staff_name ILIKE %s OR coalesce(hospital_id,'') ILIKE %s OR coalesce(email,'') ILIKE %s)
      ORDER BY is_active DESC,last_used_at DESC NULLS LAST,used_count DESC,staff_name LIMIT %s""",
      (include_inactive,role_id,role_id,q.strip(),like,like,like,limit)).fetchall()
    return {"rows":rows}


@router.get("/staff/library")
def staff_library(limit:int=Query(50,ge=1,le=200),database:Connection=Depends(connection)):
    return {"rows":database.execute("""SELECT hospital_id,personal_id,email,th_first_name,th_last_name,en_first_name,en_last_name,innovian_id,
      staff_role_id AS role_id,staff_name AS name,staff_role AS role,entry_year,is_active,used_count,last_used_at
      FROM staff_directory WHERE is_active=1 ORDER BY last_used_at DESC NULLS LAST,used_count DESC,staff_name LIMIT %s""",(limit,)).fetchall()}


@router.post("/staff/directory")
def create_staff(payload:dict=Body(...),actor:dict=Depends(current_user),database:Connection=Depends(connection)):
    values=staff_values(database,payload)
    with database.transaction():
        existing=None
        if values["hospital_id"]: existing=database.execute("SELECT * FROM staff_directory WHERE hospital_id=%s",(values["hospital_id"],)).fetchone()
        if not existing and values["email"]: existing=database.execute("SELECT * FROM staff_directory WHERE lower(email)=lower(%s)",(values["email"],)).fetchone()
        if not existing: existing=database.execute("SELECT * FROM staff_directory WHERE staff_name=%s AND staff_role_id=%s",(values["staff_name"],values["staff_role_id"])).fetchone()
        current=now_ms()
        values.update(is_active=1,last_used_at=current,updated_at=current)
        row=update(database,"staff_directory",existing["id"],values) if existing else insert(database,"staff_directory",dict(**values,used_count=0,created_at=current))
    return {"ok":True,"row":row}


@router.put("/staff/directory/{entry_id}")
def edit_staff(entry_id:int,payload:dict=Body(...),_:dict=Depends(current_user),database:Connection=Depends(connection)):
    old=database.execute("SELECT * FROM staff_directory WHERE id=%s",(entry_id,)).fetchone()
    if not old: raise HTTPException(404,"staff not found")
    values=staff_values(database,payload,old)
    values.update(is_active=flag(payload.get("is_active",old["is_active"])),updated_at=now_ms())
    return {"ok":True,"row":update(database,"staff_directory",entry_id,values)}


@router.delete("/staff/directory/{entry_id}")
def disable_staff(entry_id:int,_:dict=Depends(current_user),database:Connection=Depends(connection)):
    row=database.execute("UPDATE staff_directory SET is_active=0,updated_at=%s WHERE id=%s RETURNING id",(now_ms(),entry_id)).fetchone()
    if not row: raise HTTPException(404,"staff not found")
    return {"ok":True,"deactivated":1}


@router.get("/staff/my-cases")
def my_cases(hospital_id:str="",personal_id:str="",email:str="",database:Connection=Depends(connection)):
    if not any((hospital_id,personal_id,email)): raise HTTPException(400,"at least one of hospital_id, personal_id, email required")
    rows=database.execute("""SELECT DISTINCT c.id,c.case_code,c.hn,c.start_time,c.discharge_time,c.status,cs.staff_role,cs.staff_name
      FROM case_staff cs JOIN cases c ON c.id=cs.case_id WHERE (%s<>'' AND cs.hospital_id=%s) OR (%s<>'' AND cs.personal_id=%s)
      OR (%s<>'' AND lower(cs.email)=lower(%s)) ORDER BY c.start_time DESC LIMIT 200""",
      (hospital_id,hospital_id,personal_id,personal_id,email,email)).fetchall()
    return {"rows":rows}


@router.put("/{case_id}/staff")
def replace_staff(case_id:int,payload:dict=Body(...),actor:dict=Depends(current_user),database:Connection=Depends(connection)):
    raw=payload.get("staff") if isinstance(payload.get("staff"),list) else []
    if len(raw)>200: raise HTTPException(400,"too many staff rows")
    with database.transaction():
        editable_case(database,case_id)
        before=database.execute("SELECT * FROM case_staff WHERE case_id=%s ORDER BY seq,id",(case_id,)).fetchall()
        normalized=[]
        seen=set()
        for item in raw:
            values=staff_values(database,item)
            key=(values["staff_name"].lower(),values["staff_role_id"],(values["hospital_id"] or "").lower())
            if key in seen: continue
            seen.add(key); normalized.append(values)
        database.execute("DELETE FROM case_staff WHERE case_id=%s",(case_id,))
        current=now_ms(); rows=[]
        for index,values in enumerate(normalized,1):
            row=insert(database,"case_staff",dict(case_id=case_id,**values,seq=index,created_by=actor["username"],created_at=current,updated_at=current)); rows.append(row)
            database.execute("""INSERT INTO staff_directory(hospital_id,personal_id,email,th_first_name,th_last_name,en_first_name,en_last_name,innovian_id,staff_role_id,staff_name,staff_role,entry_year,is_active,used_count,last_used_at,created_at,updated_at)
              VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1,1,%s,%s,%s)
              ON CONFLICT(staff_name,staff_role) DO UPDATE SET used_count=staff_directory.used_count+1,last_used_at=excluded.last_used_at,updated_at=excluded.updated_at""",
              tuple(values[k] for k in ("hospital_id","personal_id","email","th_first_name","th_last_name","en_first_name","en_last_name","innovian_id","staff_role_id","staff_name","staff_role","entry_year"))+(current,current,current,))
        case_audit(database,case_id,"staff.replace",before,rows,actor)
    return {"ok":True,"case_id":case_id,"rows":[dict(id=r["id"],hospital_id=r["hospital_id"],personal_id=r["personal_id"],email=r["email"],th_first_name=r["th_first_name"],th_last_name=r["th_last_name"],en_first_name=r["en_first_name"],en_last_name=r["en_last_name"],innovian_id=r["innovian_id"],role_id=r["staff_role_id"],name=r["staff_name"],role=r["staff_role"],entry_year=r["entry_year"],seq=r["seq"]) for r in rows]}


def io_code(value):
    tokens=re.findall(r"[A-Za-z0-9]+",str(value or ""))
    return "" if not tokens else tokens[0].lower()+"".join(token.title() for token in tokens[1:])


@router.get("/io/master")
def io_master(kind:str="med",q:str="",include_inactive:bool=False,limit:int=Query(300,ge=1,le=500),database:Connection=Depends(connection)):
    kind=kind if kind in {"med","fluid","output"} else "med"; like=f"%{q.strip()}%"
    rows=database.execute("""SELECT * FROM io_item_master WHERE kind=%s AND (%s OR is_active=1)
      AND (%s='' OR code ILIKE %s OR name ILIKE %s OR coalesce(category,'') ILIKE %s OR coalesce(default_unit,'') ILIKE %s)
      ORDER BY is_active DESC,usage_rank NULLS LAST,usage_score DESC,name,code LIMIT %s""",(kind,include_inactive,q.strip(),like,like,like,like,limit)).fetchall()
    return {"rows":rows}


def master_values(payload,old=None):
    old=old or {}; kind=payload.get("kind",old.get("kind","med")); kind=kind if kind in {"med","fluid","output"} else "med"
    name=text(payload.get("name",old.get("name")))
    if not name: raise HTTPException(400,"name required")
    code=io_code(payload.get("code",old.get("code")) or name)
    if not code: raise HTTPException(400,"code or valid name required")
    return dict(kind=kind,code=code,name=name,default_unit=text(payload.get("default_unit",old.get("default_unit"))) or "ml",category=text(payload.get("category",old.get("category"))),is_active=flag(payload.get("is_active",old.get("is_active",1))),updated_at=now_ms())


@router.post("/io/master")
def create_master(payload:dict=Body(...),_:dict=Depends(current_user),database:Connection=Depends(connection)):
    values=master_values(payload); base=values["code"]; suffix=2
    while database.execute("SELECT 1 FROM io_item_master WHERE code=%s",(values["code"],)).fetchone(): values["code"]=base+str(suffix); suffix+=1
    return {"ok":True,"row":insert(database,"io_item_master",dict(**values,created_at=now_ms()))}


@router.put("/io/master/{item_id}")
def edit_master(item_id:int,payload:dict=Body(...),_:dict=Depends(current_user),database:Connection=Depends(connection)):
    old=database.execute("SELECT * FROM io_item_master WHERE id=%s",(item_id,)).fetchone()
    if not old: raise HTTPException(404,"not found")
    values=master_values(payload,old); base=values["code"]; suffix=2
    while database.execute("SELECT 1 FROM io_item_master WHERE code=%s AND id<>%s",(values["code"],item_id)).fetchone(): values["code"]=base+str(suffix); suffix+=1
    return {"ok":True,"row":update(database,"io_item_master",item_id,values)}


@router.delete("/io/master/{item_id}")
def disable_master(item_id:int,_:dict=Depends(current_user),database:Connection=Depends(connection)):
    row=database.execute("UPDATE io_item_master SET is_active=0,updated_at=%s WHERE id=%s RETURNING id",(now_ms(),item_id)).fetchone()
    if not row: raise HTTPException(404,"not found")
    return {"ok":True,"deactivated":1}
