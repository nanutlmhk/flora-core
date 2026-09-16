"""HTTP checks against a disposable PostgreSQL database with no patient data.

Run inside the API image with FLORA_DATABASE_URL pointing to a database ending
in _test. The schema must already exist. Test rows are rolled back or retained
only in this disposable database, never in the Leaf database.
"""
import concurrent.futures
import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request
from urllib.parse import urlparse

import psycopg
from psycopg.rows import dict_row

URL = os.environ["FLORA_DATABASE_URL"]
if not urlparse(URL).path.endswith("_test"):
    raise RuntimeError("Write tests require a dedicated database ending in _test")
os.environ["FLORA_LEAF_WRITE_API"] = "true"
os.environ["FLORA_API_MODE"] = "leaf"
BASE = "http://127.0.0.1:8008"


def request(path, body=None, token=None, method=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-FLORA-Session"] = token
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers=headers, method=method or ("POST" if body is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


class LeafWrites(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = psycopg.connect(URL, autocommit=True, row_factory=dict_row)
        cls.suffix = secrets.token_hex(6)
        cls.username = "migration_test_" + cls.suffix
        cls.password = secrets.token_urlsafe(18)
        # Same scrypt parameters and binary hex salt as the legacy account records.
        salt = secrets.token_bytes(16)
        hashed = hashlib.scrypt(cls.password.encode(), salt=salt, n=16384,r=8,p=1,dklen=64).hex()
        cls.user_id = cls.database.execute(
            """INSERT INTO auth_user(username,name,role,password_salt,password_hash,is_active,created_at,updated_at)
               VALUES (%s,'Migration test','admin',%s,%s,1,1,1) RETURNING id""",
            (cls.username,salt.hex(),hashed),
        ).fetchone()["id"]
        for code in ("urine", "bloodLoss"):
            cls.database.execute(
                """INSERT INTO io_item_master(kind,code,name,default_unit,is_active,created_at,updated_at)
                   VALUES ('output',%s,%s,'mL',1,1,1) ON CONFLICT (code) DO NOTHING""",(code,code),
            )
        cls.server = subprocess.Popen([sys.executable,"-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8008","--log-level","warning"])
        for _ in range(100):
            try:
                if request("/health")[0] == 200:
                    break
            except OSError:
                time.sleep(.1)
        else:
            cls.server.terminate()
            raise RuntimeError("Test API failed to start")

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait(timeout=10)
        cls.database.close()

    def login(self):
        status,result = request("/api/auth/login",{"username":self.username,"password":self.password})
        self.assertEqual(status,200,result)
        return result["session_token"]

    def test_auth_session_and_access(self):
        self.assertEqual(request("/api/auth/login",{"username":self.username,"password":"wrong"})[0],401)
        self.assertEqual(request("/api/auth/whoami")[0],401)
        token = self.login()
        status,user = request("/api/auth/whoami",token=token)
        self.assertEqual(status,200)
        self.assertEqual(user["user"]["username"],self.username)
        stored = self.database.execute("SELECT token_hash FROM auth_session WHERE user_id=%s ORDER BY id DESC LIMIT 1",(self.user_id,)).fetchone()
        self.assertEqual(stored["token_hash"],hashlib.sha256(token.encode()).hexdigest())
        self.assertEqual(request("/api/auth/self/preferences",{"theme_mode":"dark","theme_color":"warm"},token,"PUT")[0],200)
        self.assertEqual(request("/api/auth/whoami",token=token)[1]["user"]["themeColor"],"warm")
        self.assertEqual(request("/api/auth/self/preferences",{"theme_mode":"dark","theme_color":"invalid"},token,"PUT")[0],400)
        self.assertEqual(request("/api/auth/logout",{},token)[0],200)
        self.assertEqual(request("/api/auth/whoami",token=token)[0],401)

    def test_case_lifecycle_and_concurrent_start(self):
        token = self.login()
        start = 1750000000000
        self.assertEqual(request("/api/case/start",{"hn":"test","start_time":start})[0],401)
        def create(_):
            return request("/api/case/start",{"hn":"TEST-"+self.suffix,"start_time":start},token)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(create,range(2)))
        self.assertEqual(sorted(status for status,_ in responses),[200,409],responses)
        case = next(body for status,body in responses if status == 200)
        case_id = case["case_id"]
        runs = self.database.execute("SELECT * FROM case_io_run WHERE case_id=%s",(case_id,)).fetchall()
        self.assertEqual(len(runs),2)
        self.assertEqual(self.database.execute("SELECT count(*) AS n FROM case_io_audit WHERE case_id=%s",(case_id,)).fetchone()["n"],2)
        self.assertEqual(request("/api/case/archive",{"case_id":case_id},token)[0],400)
        self.assertEqual(request("/api/case/discharge",{"case_id":case_id,"discharge_time":start-3600000},token)[0],400)
        status,result = request("/api/case/discharge",{"case_id":case_id,"discharge_time":start+3600000},token)
        self.assertEqual(status,200,result)
        self.assertEqual(request("/api/case/archive",{"case_id":case_id},token)[0],200)
        self.assertEqual(request(f"/api/case/{case_id}/start-time",{"start_time":start},token,"PUT")[0],409)
        self.assertEqual(request("/api/case/archive",{"case_id":case_id},token)[0],200)

    def test_password_change_and_deactivation(self):
        token = self.login()
        self.assertEqual(request("/api/auth/self/change-password",{"current_password":"wrong","new_password":"test-pass-123"},token)[0],400)
        self.assertEqual(request("/api/auth/self/change-password",{"current_password":self.password,"new_password":"short"},token)[0],400)
        status,result = request("/api/auth/self/change-password",{"current_password":self.password,"new_password":"test-pass-123"},token)
        self.assertEqual(status,200,result)
        self.assertEqual(request("/api/auth/login",{"username":self.username,"password":self.password})[0],401)
        self.__class__.password = "test-pass-123"
        new_token = self.login()
        self.assertEqual(request(f"/api/auth/users/{self.user_id}/active",{"is_active":False},new_token,"PUT")[0],200)
        self.assertEqual(request("/api/auth/whoami",token=token)[0],401)
        self.assertEqual(request("/api/auth/whoami",token=new_token)[0],401)
        self.assertEqual(request("/api/auth/login",{"username":self.username,"password":self.password})[0],401)

    def test_clinical_writes_and_audit_rollback(self):
        token = self.login()
        start = 1760000400000
        status,case = request("/api/case/start",{"hn":"CLINICAL-"+self.suffix,"start_time":start},token)
        self.assertEqual(status,200,case)
        case_id = case["case_id"]
        root = f"/api/case/{case_id}"
        for category,field in (("diagnosis","diagnosis_text"),("procedures","procedure_text"),("allergies","allergen")):
            status,result = request(root+"/"+category,{field:"Synthetic test entry"},token)
            self.assertEqual(status,200,result)
            entry = result["id"]
            self.assertEqual(request(root+f"/{category}/{entry}",{field:"Corrected entry"},token,"PUT")[0],200)
            self.assertEqual(request(root+f"/{category}/{entry}",token=token,method="DELETE")[0],200)
        self.assertEqual(request(root+"/detail-draft",{"draft":{"asa":"II","note":"test"}},token,"PUT")[0],200)
        self.assertEqual(request(root+"/detail-draft",token=token)[1]["draft"]["asa"],"II")
        self.assertEqual(request(root+"/events",{"title":"End ANE","event_ts":start},token)[0],400)
        status,event = request(root+"/events",{"title":"Start ANE","event_ts":start},token)
        self.assertEqual(status,200,event)
        self.assertEqual(request(root+"/events",{"title":"Start ANE","event_ts":start+60000},token)[0],400)
        self.assertEqual(request(root+"/events",{"title":"End ANE","event_ts":start+60000},token)[0],200)
        self.assertEqual(request(root+f"/events/{event['id']}",{"detail":"Corrected note"},token,"PUT")[0],200)
        changes=[{"ts_minute":start,"param_key":"hr","value":70,"value_type":"number"}]
        status,result = request(root+"/timeline",{"changes":changes},token,"PUT")
        self.assertEqual(status,200,result)
        self.assertEqual(result["inserted"],1)
        changes[0]["value"]=80
        status,result = request(root+"/timeline",{"changes":changes},token,"PUT")
        self.assertEqual(status,200,result)
        self.assertEqual(result["updated"],1)
        changes[0]["value"]=90
        changes.append({"ts_minute":start,"param_key":"spo2","value":"invalid","value_type":"number"})
        self.assertEqual(request(root+"/timeline",{"changes":changes},token,"PUT")[0],400)
        saved=self.database.execute("SELECT value_num FROM case_timeline_value WHERE case_id=%s AND param_key='hr'",(case_id,)).fetchone()
        self.assertEqual(saved["value_num"],80)
        self.assertEqual(self.database.execute("SELECT count(*) AS n FROM case_timeline_audit WHERE case_id=%s",(case_id,)).fetchone()["n"],2)
        self.assertGreater(self.database.execute("SELECT count(*) AS n FROM case_clinical_audit WHERE case_id=%s",(case_id,)).fetchone()["n"],0)
        self.assertEqual(request("/api/case/discharge",{"case_id":case_id,"discharge_time":start+3600000},token)[0],200)
        self.assertEqual(request("/api/case/archive",{"case_id":case_id},token)[0],200)
        self.assertEqual(request(root+"/detail-draft",{"draft":{}},token,"PUT")[0],409)

    def test_catalog_io_and_ephis_writes(self):
        token = self.login()
        start = 1770000000000
        status, case = request("/api/case/start", {"hn":"IO-"+self.suffix,"start_time":start}, token)
        self.assertEqual(status, 200, case)
        case_id = case["case_id"]
        status, master = request("/api/case/io/master", {
            "kind":"med", "code":"testMed"+self.suffix, "name":"Synthetic medication", "default_unit":"mg"
        }, token)
        self.assertEqual(status, 200, master)
        item_id = master["row"]["id"]
        status, event = request(f"/api/case/{case_id}/io/events", {
            "item_id":item_id, "kind":"med", "event_ts":start, "dose_value":2, "dose_unit":"mg"
        }, token)
        self.assertEqual(status, 200, event)
        status, summary = request(f"/api/case/{case_id}/io/summary?from={start}&to={start+60000}", token=token)
        self.assertEqual(status, 200, summary)
        tsv = "HN\tAdmit Date\nEPHIS-"+self.suffix+"\t2026-09-16"
        status, imported = request("/api/ephis/import-daily-cases", {"tsvText":tsv,"replaceExisting":True}, token)
        self.assertEqual(status, 200, imported)
        self.assertEqual(imported["imported_rows"], 1)
        self.assertEqual(request("/api/ephis/import-status")[1]["total_rows"], 1)
        self.assertEqual(request("/api/case/discharge", {"case_id":case_id,"discharge_time":start+3600000}, token)[0], 200)


if __name__ == "__main__":
    unittest.main(verbosity=2)
