#!/usr/bin/env python3
"""Opens one active demo case on each Leaf so device data flows into a chart.

First run: signs in with the bootstrap admin, sets the demo password (the Leaf
requires a password change on first login) and starts a manual-admission case.
Re-running is safe: an existing active case is left alone.
"""
import json
import time
import urllib.error
import urllib.request

BOOTSTRAP_PASSWORD = "admin"
DEMO_PASSWORD = "FloraDemo-2026"  # local demo credential only
LEAVES = [
    {"name": "leaf-or-01", "api": "http://127.0.0.1:7301", "hn": "DEMO-OR-0001", "patient": "Demo Patient OR",
     "operation": "Laparoscopic cholecystectomy", "diagnosis": "Symptomatic cholelithiasis"},
    {"name": "leaf-icu-01", "api": "http://127.0.0.1:7311", "hn": "DEMO-ICU-0001", "patient": "Demo Patient ICU",
     "operation": "Post-operative ventilation", "diagnosis": "Septic shock"},
]


def call(api, path, body=None, token=None, method=None):
    request = urllib.request.Request(api + path, data=json.dumps(body).encode() if body is not None else None,
                                     method=method or ("POST" if body is not None else "GET"))
    request.add_header("content-type", "application/json")
    if token:
        request.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"null")


def login(api):
    for password in (DEMO_PASSWORD, BOOTSTRAP_PASSWORD):
        status, body = call(api, "/api/auth/login", {"username": "admin", "password": password})
        if status == 200:
            token = body["session_token"]
            if body["user"].get("mustChangePassword"):
                status, body = call(api, "/api/auth/self/change-password",
                                    {"current_password": password, "new_password": DEMO_PASSWORD}, token)
                if status != 200:
                    raise SystemExit(f"password change failed: {body}")
                token = login(api)
            return token
    raise SystemExit(f"cannot sign in to {api}")


for leaf in LEAVES:
    token = login(leaf["api"])
    status, body = call(leaf["api"], "/api/case/start", {
        "start_time": int(time.time() * 1000), "admission_source": "manual", "hn": leaf["hn"],
        "patient_name": leaf["patient"], "sex": "F", "age_text": "54y", "weight_kg": 62,
        "operation": leaf["operation"], "diagnosis": leaf["diagnosis"], "asa_status": "3",
    }, token)
    if status == 409:
        print(f"{leaf['name']}: active case already open ({body.get('active_case_hn')})")
    elif status == 200:
        print(f"{leaf['name']}: started case {leaf['hn']}")
    else:
        raise SystemExit(f"{leaf['name']}: start failed {status} {body}")
