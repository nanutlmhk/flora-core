"""Synthetic HIS exchange fixtures for customer demonstrations.

These records are deliberately fictional. They exercise the same lookup and
PostgreSQL buffering path as a hospital integration without impersonating a
real upstream system.
"""
from copy import deepcopy


_PATIENTS = {
    "D-HL7-001": {
        "exchange": {
            "protocol": "HL7_V2_ADT",
            "label": "HL7 v2.5 ADT",
            "event": "ADT^A01",
            "message_id": "FLORA-DEMO-ADT-A01-0001",
            "source_system": "Hospital Interface Engine",
            "encounter": {"class": "IMP", "service": "Neurosurgery", "priority": "Elective", "location": "OR-1", "attending": "Dr Demo Anan"},
            "sample_format": "HL7 ER7",
            "sample": "MSH|^~\\&|HIS|DEMO|FLORA|OR|20260916100500||ADT^A01^ADT_A01|FLORA-DEMO-ADT-A01-0001|P|2.5.1\rEVN|A01|20260916100500\rPID|1||D-HL7-001^^^DEMO^MR||Prasertsuk^Suda^^^Ms||19680412|F|||Bangkok^^Bangkok^^10100^THA\rPV1|1|I|OR^OR-1^Bed-1||||DEMO001^Anan^Demo||||SUR||||D-AN-260091|||||||||||||||||||||||||20260916103000",
            "synthetic": True,
        },
        "patientInfo": [{
            "HN": "D-HL7-001", "AN": "D-AN-260091", "TITLE": "นาง", "TITLE_EN": "Ms",
            "FNAME": "สุดา", "LNAME": "ประเสริฐสุข", "FNAME_E": "Suda", "LNAME_E": "Prasertsuk",
            "PATIENT_NAME": "นาง สุดา ประเสริฐสุข", "SEX": "F", "DOB": "1968-04-12", "AGE": "58y 5m",
            "BLOODGRP": "A+", "ABO": "A", "RH": "+", "NATIONALITY": "Thai",
        }],
        "inpatientAn": [{"HN": "D-HL7-001", "AN": "D-AN-260091"}],
        "vital": [{"WEIGHT": 61.4, "HEIGHT": 158}],
        "allergy": [{"NAME": "Penicillin", "RESULT_DIS": "Urticarial rash", "CADR": "Moderate", "STATUS": "Active"}],
        "lab": [
            {"LABNAME": "Hemoglobin", "LABGRPNAME": "CBC", "LABRESULT": "11.8", "LABUNIT": "g/dL", "LABMAXMIN": "12.0-16.0", "ABNORMALFLAG": "L"},
            {"LABNAME": "Platelet count", "LABGRPNAME": "CBC", "LABRESULT": "238", "LABUNIT": "10^3/uL", "LABMAXMIN": "150-400", "ABNORMALFLAG": ""},
        ],
    },
    "D-FHIR-001": {
        "exchange": {
            "protocol": "FHIR_R4",
            "label": "FHIR R4",
            "event": "Patient + Encounter",
            "message_id": "Patient/flora-demo-002",
            "source_system": "FHIR Gateway",
            "encounter": {"class": "inpatient", "service": "Orthopaedics", "priority": "Urgent", "location": "OR-2", "attending": "Dr Demo Narin"},
            "sample_format": "FHIR JSON",
            "sample": "{\n  \"resourceType\": \"Bundle\",\n  \"type\": \"searchset\",\n  \"entry\": [\n    {\"resource\": {\"resourceType\": \"Patient\", \"id\": \"flora-demo-002\", \"identifier\": [{\"system\": \"urn:flora:demo:hn\", \"value\": \"D-FHIR-001\"}], \"name\": [{\"family\": \"Chaisri\", \"given\": [\"Arun\"]}], \"gender\": \"male\", \"birthDate\": \"1981-11-03\"}},\n    {\"resource\": {\"resourceType\": \"Encounter\", \"id\": \"enc-demo-002\", \"status\": \"planned\", \"class\": {\"code\": \"IMP\"}, \"subject\": {\"reference\": \"Patient/flora-demo-002\"}, \"serviceType\": {\"text\": \"Orthopaedics\"}, \"priority\": {\"text\": \"Urgent\"}}}\n  ]\n}",
            "synthetic": True,
        },
        "patientInfo": [{
            "HN": "D-FHIR-001", "AN": "D-AN-260104", "TITLE": "นาย", "TITLE_EN": "Mr",
            "FNAME": "อรุณ", "LNAME": "ชัยศรี", "FNAME_E": "Arun", "LNAME_E": "Chaisri",
            "PATIENT_NAME": "นาย อรุณ ชัยศรี", "SEX": "M", "DOB": "1981-11-03", "AGE": "44y 10m",
            "BLOODGRP": "O+", "ABO": "O", "RH": "+", "NATIONALITY": "Thai",
        }],
        "inpatientAn": [{"HN": "D-FHIR-001", "AN": "D-AN-260104"}],
        "vital": [{"WEIGHT": 77.2, "HEIGHT": 174}],
        "allergy": [],
        "lab": [
            {"LABNAME": "Creatinine", "LABGRPNAME": "Renal function", "LABRESULT": "0.92", "LABUNIT": "mg/dL", "LABMAXMIN": "0.67-1.17", "ABNORMALFLAG": ""},
            {"LABNAME": "Potassium", "LABGRPNAME": "Electrolyte", "LABRESULT": "4.1", "LABUNIT": "mmol/L", "LABMAXMIN": "3.5-5.1", "ABNORMALFLAG": ""},
        ],
    },
    "D-MPI-001": {
        "exchange": {
            "protocol": "IHE_PDQm",
            "label": "IHE PDQm",
            "event": "Patient demographic query",
            "message_id": "urn:uuid:flora-demo-pdqm-0003",
            "source_system": "Enterprise MPI",
            "encounter": {"class": "AMB", "service": "General surgery", "priority": "Elective", "location": "Day Surgery", "attending": "Dr Demo Kanya"},
            "sample_format": "FHIR JSON (PDQm)",
            "sample": "{\n  \"resourceType\": \"Bundle\",\n  \"type\": \"searchset\",\n  \"link\": [{\"relation\": \"self\", \"url\": \"Patient?identifier=D-MPI-001\"}],\n  \"entry\": [{\"fullUrl\": \"urn:uuid:flora-demo-pdqm-0003\", \"resource\": {\"resourceType\": \"Patient\", \"id\": \"mpi-demo-003\", \"identifier\": [{\"system\": \"urn:flora:enterprise-mpi\", \"value\": \"D-MPI-001\"}], \"name\": [{\"family\": \"Kittipong\", \"given\": [\"Malee\"]}], \"gender\": \"female\", \"birthDate\": \"1993-07-26\"}}]\n}",
            "synthetic": True,
        },
        "patientInfo": [{
            "HN": "D-MPI-001", "AN": "D-AN-260118", "TITLE": "นางสาว", "TITLE_EN": "Ms",
            "FNAME": "มาลี", "LNAME": "กิตติพงศ์", "FNAME_E": "Malee", "LNAME_E": "Kittipong",
            "PATIENT_NAME": "นางสาว มาลี กิตติพงศ์", "SEX": "F", "DOB": "1993-07-26", "AGE": "33y 1m",
            "BLOODGRP": "B-", "ABO": "B", "RH": "-", "NATIONALITY": "Thai",
        }],
        "inpatientAn": [{"HN": "D-MPI-001", "AN": "D-AN-260118"}],
        "vital": [{"WEIGHT": 54.8, "HEIGHT": 163}],
        "allergy": [{"NAME": "Latex", "RESULT_DIS": "Bronchospasm", "CADR": "Severe", "STATUS": "Active"}],
        "lab": [
            {"LABNAME": "Hemoglobin", "LABGRPNAME": "CBC", "LABRESULT": "13.2", "LABUNIT": "g/dL", "LABMAXMIN": "12.0-16.0", "ABNORMALFLAG": ""},
            {"LABNAME": "INR", "LABGRPNAME": "Coagulation", "LABRESULT": "1.02", "LABUNIT": "", "LABMAXMIN": "0.80-1.20", "ABNORMALFLAG": ""},
        ],
    },
}


def find_demo_patient(hn: str, full: bool = True):
    fixture = _PATIENTS.get(str(hn or "").strip().upper())
    if not fixture:
        return None
    payload = deepcopy(fixture)
    exchange = payload.pop("exchange")
    if not full:
        payload = {"patientInfo": payload["patientInfo"], "inpatientAn": payload["inpatientAn"], "vital": payload["vital"]}
    payload["_flora_exchange"] = exchange
    return payload


def demo_patient_catalog():
    result = []
    for hn, fixture in _PATIENTS.items():
        patient = fixture["patientInfo"][0]
        result.append({
            "hn": hn,
            "patient_name": patient["PATIENT_NAME"],
            "patient_name_en": f'{patient["FNAME_E"]} {patient["LNAME_E"]}',
            "protocol": fixture["exchange"]["protocol"],
            "protocol_label": fixture["exchange"]["label"],
            "event": fixture["exchange"]["event"],
            "source_system": fixture["exchange"]["source_system"],
            "encounter": fixture["exchange"]["encounter"],
            "sample_format": fixture["exchange"]["sample_format"],
            "sample": fixture["exchange"]["sample"],
            "synthetic": True,
        })
    return result
