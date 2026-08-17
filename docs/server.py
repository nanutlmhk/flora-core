from flask import Flask, request, jsonify, Response
import requests
import xmltodict
import sys
import os
import time
from functools import wraps

app = Flask(__name__)

BASE_URL = "https://service-api.kcmh.or.th/ws_inpt/Service.asmx"
BEARER_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjAwMDEifQ.eyJpZCI6IjAwMDEiLCJncm91cCI6ImFkbWluIiwibmFtZSI6ImFkbWluIiwiZXhwIjozMTM3OTYxNjAwfQ.aGZGzyLUTxhGIjOZeAlhPc3LrqTwnNM83qdoMTaKCzg"  # Hardcode your token here

# ===== Rate Limiting Setup =====
last_request_time = {}
RATE_LIMIT_SECONDS = 10

def rate_limited(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        ip = request.remote_addr or "unknown"
        now = time.time()
        last_time = last_request_time.get(ip, 0)
        if now - last_time < RATE_LIMIT_SECONDS:
            remaining = RATE_LIMIT_SECONDS - (now - last_time)
            return jsonify({
                "error": f"Too many requests. Try again in {remaining:.1f} seconds."
            }), 429
        last_request_time[ip] = now
        return func(*args, **kwargs)
    return wrapper


# ===== Utility Functions =====
def get_test_html_path():
    if getattr(sys, 'frozen', False):
        base_path = sys._MEIPASS
    else:
        base_path = os.path.dirname(__file__)
    return os.path.join(base_path, "test.html")


def call_soap(action, soap_payload):
    url = f"{BASE_URL}?op={action}"
    headers = {
        "Authorization": f"Bearer {BEARER_TOKEN}",
        "Content-Type": "text/xml"
    }
    response = requests.post(url, data=soap_payload, headers=headers, verify=False, timeout=30)
    response.raise_for_status()
    return response.text


def extract_data(xml_response, result_key):
    try:
        data = xmltodict.parse(xml_response)
        body = data.get("soap:Envelope", {}).get("soap:Body", {})
        for value in body.values():
            if isinstance(value, dict) and result_key in value:
                return value[result_key]
        return {"error": "Result not found in SOAP response"}
    except Exception as e:
        return {"error": f"Failed to parse XML: {str(e)}"}


# ===== Routes =====
@app.route("/")
def serve_ui():
    try:
        with open(get_test_html_path(), "r", encoding="utf-8") as f:
            return Response(f.read(), mimetype="text/html")
    except Exception as e:
        return f"Failed to load UI: {e}", 500


@app.route("/api/patient-info", methods=["POST"])
@rate_limited
def patient_info():
    hn = request.json.get("hn", "")
    soap_payload = f"""
    <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                   xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <getPatientInfo xmlns="http://cuhapp.chulalongkornhospital.go.th/ws_inpt/Service">
          <hn>{hn}</hn>
          <idcard></idcard>
        </getPatientInfo>
      </soap:Body>
    </soap:Envelope>
    """
    return jsonify(extract_data(call_soap("getpatientinfo", soap_payload), "getPatientInfoResult"))


@app.route("/api/inpatient-an", methods=["POST"])
@rate_limited
def inpatient_an():
    an = request.json.get("an", "")
    soap_payload = f"""
    <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                   xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <getInPatientAn xmlns="http://cuhapp.chulalongkornhospital.go.th/ws_inpt/Service">
          <AN>{an}</AN>
        </getInPatientAn>
      </soap:Body>
    </soap:Envelope>
    """
    return jsonify(extract_data(call_soap("getinpatientan", soap_payload), "getInPatientAnResult"))


@app.route("/api/patient-allergy", methods=["POST"])
@rate_limited
def patient_allergy():
    hn = request.json.get("hn", "")
    soap_payload = f"""
    <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                   xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <getPatientAllergy xmlns="http://cuhapp.chulalongkornhospital.go.th/ws_inpt/Service">
          <HN>{hn}</HN>
        </getPatientAllergy>
      </soap:Body>
    </soap:Envelope>
    """
    return jsonify(extract_data(call_soap("getpatientallergy", soap_payload), "getPatientAllergyResult"))


@app.route("/api/lab-result", methods=["POST"])
@rate_limited
def lab_result():
    hn = request.json.get("hn", "")
    labgrp = request.json.get("labgrp", "28")
    soap_payload = f"""
    <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                   xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <getLabResult xmlns="http://cuhapp.chulalongkornhospital.go.th/ws_inpt/Service">
          <hn>{hn}</hn>
          <labgrp>{labgrp}</labgrp>
        </getLabResult>
      </soap:Body>
    </soap:Envelope>
    """
    return jsonify(extract_data(call_soap("getlabresult", soap_payload), "getLabResultResult"))


@app.route("/api/patient-vital", methods=["POST"])
@rate_limited
def patient_vital():
    hn = request.json.get("hn", "")
    soap_payload = f"""
    <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                   xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <getPatientVital xmlns="http://cuhapp.chulalongkornhospital.go.th/ws_inpt/Service">
          <hn>{hn}</hn>
        </getPatientVital>
      </soap:Body>
    </soap:Envelope>
    """
    return jsonify(extract_data(call_soap("getpatientvital", soap_payload), "getPatientVitalResult"))


# ===== Run Server =====
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8590)
