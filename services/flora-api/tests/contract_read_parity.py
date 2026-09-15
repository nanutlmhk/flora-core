import json
import os
import sys
from urllib.request import urlopen


legacy_url = os.environ["LEGACY_API_URL"].rstrip("/")
python_url = os.environ["PYTHON_API_URL"].rstrip("/")


def fetch(base: str, path: str):
    with urlopen(base + path, timeout=30) as response:
        return json.load(response)


def compare(path: str, ignore: tuple[str, ...] = ()) -> None:
    legacy = fetch(legacy_url, path)
    replacement = fetch(python_url, path)
    for key in ignore:
        legacy.pop(key, None)
        replacement.pop(key, None)
    if legacy != replacement:
        print(f"FAIL {path}", file=sys.stderr)
        print(f"legacy={json.dumps(legacy, ensure_ascii=False)[:1000]}", file=sys.stderr)
        print(f"python={json.dumps(replacement, ensure_ascii=False)[:1000]}", file=sys.stderr)
        raise SystemExit(1)
    print(f"PASS {path}")


# Live status is intentionally not compared byte-for-byte during the dual-write
# transition: the legacy SQLite writer and PostgreSQL snapshot advance separately.
for base, label in ((legacy_url, "legacy"), (python_url, "python")):
    status_payload = fetch(base, "/api/case/status")
    if "status" not in status_payload:
        raise SystemExit(f"FAIL /api/case/status missing status from {label}")
print("PASS /api/case/status response shape (volatile sources checked independently)")
legacy_case_list = fetch(legacy_url, "/api/case/list?limit=30")
python_case_list = fetch(python_url, "/api/case/list?limit=30")
for payload in (legacy_case_list, python_case_list):
    for row in payload.get("rows", []):
        row.pop("status", None)
if legacy_case_list != python_case_list:
    raise SystemExit("FAIL /api/case/list?limit=30 excluding volatile status")
print("PASS /api/case/list?limit=30 (volatile status checked independently)")

case_rows = fetch(legacy_url, "/api/case/list?limit=30")["rows"]
stable_cases = [row for row in case_rows if row["status"] != "ACTIVE"][:2]
if not stable_cases:
    raise SystemExit("FAIL no stable case is available for contract validation")

for case in stable_cases:
    case_id = case["case_id"]
    start = case["start_time"]
    end = case["discharge_time"] or start
    query = f"from={start}&to={end}"
    paths = [
        f"/api/case/{case_id}/vitals?{query}",
        f"/api/case/{case_id}/events?{query}&limit=300",
        f"/api/case/{case_id}/timeline?{query}",
        f"/api/case/{case_id}/timeline/effective?{query}",
        f"/api/case/{case_id}/timeline/audit?{query}",
        f"/api/case/{case_id}/detail-draft",
        f"/api/case/{case_id}/patient",
        f"/api/case/{case_id}/allergies",
        f"/api/case/{case_id}/labs",
        f"/api/case/{case_id}/diagnosis",
        f"/api/case/{case_id}/procedures",
        f"/api/case/{case_id}/staff",
        f"/api/case/{case_id}/io/items?kind=fluid",
        f"/api/case/{case_id}/io/items?kind=med",
        f"/api/case/{case_id}/io/items?kind=output",
        f"/api/case/{case_id}/io/runs?{query}",
        f"/api/case/{case_id}/io/events?{query}",
        f"/api/case/{case_id}/io/summary?{query}&bucket=1",
        f"/api/case/{case_id}/io/audit?{query}",
    ]
    for path in paths:
        compare(path)
    compare(f"/api/case/{case_id}/timeaxis?step=60", ignore=("server_time",))

compare("/api/case/staff/roles")
print(f"PASS read contract for {len(stable_cases)} stable cases")
