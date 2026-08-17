# Porjai - Abstract HIS Integration API Specification

Version 5.0 Draft for Confirmation

Profile: BKI / Abstract HIS Integration  
Protocol: REST API / SOAP Web Service  
Format: JSON / XML  
Encoding: UTF-8  
Timezone: Asia/Bangkok (UTC+7)

## Changes After Version 4

- Added BKI medication usage master references received as `meduseunit.xls` and `medusertype.xls`.
- Replaced our free-text dose unit and administration/type values with HIS API code fields `meduesunit` and `meduestype`; Porjai performs the mapping from the supplied master tables before sending API 2.
- Removed the `notes` field from API 2 request fields and all drug order examples.
- Added `qty` for the number of drug dispensing units ordered.
- Clarified that `coverage_code` is received for patient classification only and is not sent in API 2 drug orders.
- Added the dialysis clinic codes supplied in the v4 review: `1004`, `1005`, and `1006`.

## Items Requiring Abstract Confirmation

1. API examples use the v4 annotated request field names `meduesunit` and `meduestype`. Confirm these exact JSON/XML names with Abstract HIS before implementation.
2. This draft uses working `meduesunit` code `151` for `UNIT`/`IU`. Confirm whether this is the required active code because the supplied `meduseunit.xls` contains multiple UNIT rows.
3. Confirm that the dialysis clinic code list is complete and whether Porjai must restrict API 2 orders to these clinics only.

## 1. Overview

This document defines the abstract integration contract between Porjai middleware and Abstract HIS.

This version contains 2 APIs:

- API 1: Porjai sends HN and receives patient demographics, visit, clinic, doctor, and coverage information.
- API 2: Porjai sends drug order data to Abstract HIS.

Drug ordering is based on the agreed medication mapping. The outbound order payload sends `med_item` for the HIS medication item, `dose_amount` for the prescribed dose, and `qty` for the number of units to dispense.

In v4, Porjai expressed dose unit and administration/type as readable text, such as `IU` and `Intravenous`. Following BKI's supplied master files, API 2 now sends their corresponding codes in `meduesunit` and `meduestype` rather than text descriptions. The medication package or dosage form, such as prefilled syringe or vial, comes from the medication mapping and is not a substitute for `meduesunit`.

## 2. Technical Requirements

| Item | Requirement |
| --- | --- |
| Protocol | REST / SOAP |
| Format | JSON / XML |
| Encoding | UTF-8 |
| Authentication | API Key / Bearer Token / Custom Header |
| Timeout | 60 seconds |
| Retry | 3 times, network error only |
| Datetime Format | YYYY-MM-DDTHH:mm:ss |
| Timezone | Asia/Bangkok (UTC+7) |

## 3. API 1: Get Patient Information By HN

Porjai posts HN to Abstract HIS and receives patient and current visit information in return.

### 3.1 Request Fields

| Field Name | Type | Description | Example | Remark |
| --- | --- | --- | --- | --- |
| `hn` | string | Hospital Number | 1234567 | Required |

### 3.2 Response Fields

| Field Name | Type | Description | Example | Remark |
| --- | --- | --- | --- | --- |
| `hn` | string | Hospital Number | 1234567 | |
| `visit_no` | string | Visit Number | 6704010001 | |
| `en_firstname` | string | Patient first name in English | PORJAI | |
| `en_lastname` | string | Patient last name in English | JAIDEE | |
| `th_firstname` | string | Patient first name in Thai | พอใจ | |
| `th_lastname` | string | Patient last name in Thai | ใจดี | |
| `gender` | string | Gender code | 10 | Code supplied by Abstract HIS |
| `dob` | date | Date of birth | 1980-05-15 | Confirm whether date-only or datetime is required |
| `clinic_code` | string | Dialysis clinic code | 1004 | See section 3.3 |
| `clinic_name` | string | Clinic name | Kidney Clinic | |
| `doctor_code` | string | Doctor code | 7275524 | |
| `doctor_name` | string | Doctor name | DR. NITINAN | |
| `coverage_code` | string | Current coverage / benefit code | OFC | Used by Porjai for patient classification only |
| `coverage_name` | string | Current coverage / benefit name | Out-of-pocket | |

### 3.3 Dialysis Clinic Code Reference

| `clinic_code` | Clinic Name |
| --- | --- |
| `1004` | ไตเทียม 1 |
| `1005` | ไตเทียม 2 |
| `1006` | ไตเทียม 3 |

API 1 returns the clinic for the current visit. API 2 sends the same selected/current clinic code back with the drug order so Abstract HIS can route the order to the correct dialysis clinic context.

## 4. API 2: Send Drug Order To HIS

Porjai sends a drug order payload to Abstract HIS. The request intentionally does not include an order note.

### 4.1 Request Fields

| Field Name | Type | Description | Example | Remark |
| --- | --- | --- | --- | --- |
| `hn` | string | Hospital Number | 1234567 | Required |
| `vn` | string | Visit Number | 6704010001 | Required |
| `order_datetime` | datetime | Drug order datetime | 2026-04-01T09:30:00 | ISO 8601 |
| `doctor_code` | string | Doctor code | 7275524 | |
| `clinic_code` | string | Dialysis clinic code for the order | 1004 | Values: `1004`, `1005`, `1006` |
| `diag` | string | Diagnosis code | N185 | Header-level field |
| `order_items` | array | Drug order item list | [...] | At least 1 item |

### 4.2 `order_items` Fields

| Field Name | Type | Description | Example | Remark |
| --- | --- | --- | --- | --- |
| `med_item` | number | HIS medication item code used for ordering | 8197 | Required |
| `price` | number | Unit price | 0.00 | Optional unless Abstract requires it |
| `pack_sequence` | number | Pack sequence from mapping sheet | 1 | |
| `dose_amount` | number | Prescribed dose amount | 3000 | Clinical dose, not number of packs |
| `qty` | number | Number of the selected HIS medication item/package ordered | 1 | Total dose is derived from item strength multiplied by `qty` across order rows |
| `meduesunit` | number | Dose/use unit code mapped from `meduseunit.xls` | 151 | Working mapping: `151` = `UNIT`/`IU`; confirm final active code |
| `meduestype` | string | Administration/use code mapped from `medusertype.xls` | IV1 | `IV1` = administer intravenously |
| `med_ned` | number | MEDNED reason number | 8 | Send numeric value when required |

### 4.3 Unit And Type Code Mapping

Porjai maps its medication display/clinical values to the BKI master values before posting API 2:

| Porjai Value Before Mapping | BKI Master File | API Field Sent | Example Code Sent |
| --- | --- | --- | --- |
| Dose unit text such as `IU` / `UNIT` | `meduseunit.xls` | `meduesunit` | `151` |
| Dose unit text such as `mg` | `meduseunit.xls` | `meduesunit` | `124` |
| Dose unit text such as `mcg` | `meduseunit.xls` | `meduesunit` | `121` |
| Dose unit text such as `mL` | `meduseunit.xls` | `meduesunit` | `126` |
| Administration/type such as IV single-dose administration | `medusertype.xls` | `meduestype` | `IV1` |

`meduestype` must follow the intended administration instruction, not just a broad text match. For example, the supplied master includes separate values for intravenous injection (`IV`), IV administration (`IV1`), IV drip (`IV2`), IV push (`IV4`), and peripheral-vein infusion (`PER`). The final mapping rules must be confirmed with BKI.

`medinterface.xlsx` provides the mapped medication item and package details, for example `3EPRE3000` / `meditem` `8197` is Eprex 3,000 IU in a prefilled syringe. This supports `med_item`, `dose_amount`, and `qty`; the `meduesunit` and `meduestype` API values are mapped from the separate usage master files.

### 4.4 Quantity Mapping Rule

`qty` is the count of each selected HIS medication item/package. Porjai sends the HIS item combination selected for the patient's drug order.

For example, an order for 8,000 IU may be represented according to available HIS items as follows:

| Available Item Combination | API Order Rows | Item Quantity Sent |
| --- | --- | --- |
| 5,000 IU and 3,000 IU items | `med_item` for 5,000 IU with `qty: 1`; `med_item` for 3,000 IU with `qty: 1` | `1` + `1` |
| 3,000 IU item only | `med_item` for 3,000 IU with `qty: 3` | `3` |
| 2,000 IU item only | `med_item` for 2,000 IU with `qty: 4` | `4` |

The selected item combination depends on the HIS items available for ordering.

### 4.5 Coverage Classification

Abstract HIS sends `coverage_code` in API 1 so Porjai can classify the patient according to the coverage/benefit information received. `coverage_code` is not part of the API 2 drug order request and is not sent back when Porjai posts an order.

### 4.6 Medication Usage Master Files

| File Received | Key Column | Usage In API 2 | Example |
| --- | --- | --- | --- |
| `medinterface.xlsx` | `meditem`, `PACKSEQ` | `order_items.med_item`, `pack_sequence`, dose/quantity reference | `8197` = Eprex 3,000 IU prefilled syringe |
| `meduseunit.xls` | `meduseunit` | `order_items.meduesunit` | Working code `151` = `UNIT`/`IU` |
| `medusertype.xls` | `medusetype` | `order_items.meduestype` | `IV1` = administer intravenously |

## 5. REST API Examples

### 5.1 API 1 Request

```json
{
  "hn": "1234567"
}
```

### 5.2 API 1 Success Response

```json
{
  "status": "SUCCESS",
  "data": {
    "hn": "1234567",
    "visit_no": "6704010001",
    "en_firstname": "PORJAI",
    "en_lastname": "JAIDEE",
    "th_firstname": "พอใจ",
    "th_lastname": "ใจดี",
    "gender": "10",
    "dob": "1980-05-15",
    "clinic_code": "1004",
    "clinic_name": "Kidney Clinic",
    "doctor_code": "7275524",
    "doctor_name": "DR. NITINAN",
    "coverage_code": "OFC",
    "coverage_name": "Out-of-pocket"
  }
}
```

### 5.3 API 2 Drug Order Request

```json
{
  "hn": "1234567",
  "vn": "6704010001",
  "order_datetime": "2026-04-01T09:30:00",
  "doctor_code": "7275524",
  "clinic_code": "1004",
  "diag": "N185",
  "order_items": [
    {
      "med_item": 8197,
      "price": 0.00,
      "pack_sequence": 1,
      "dose_amount": 3000,
      "qty": 1,
      "meduesunit": 151,
      "meduestype": "IV1"
    }
  ]
}
```

### 5.4 API 2 Split-Item Quantity Example: 8,000 IU

This example uses the available Binocrit items from `medinterface.xlsx`: 5,000 IU plus 3,000 IU, each with `qty` `1`.

```json
{
  "hn": "1234567",
  "vn": "6704010001",
  "order_datetime": "2026-04-01T09:45:00",
  "doctor_code": "7275524",
  "clinic_code": "1004",
  "diag": "N185",
  "order_items": [
    {
      "med_item": 39800,
      "pack_sequence": 1,
      "dose_amount": 5000,
      "qty": 1,
      "meduesunit": 151,
      "meduestype": "IV1"
    },
    {
      "med_item": 39799,
      "pack_sequence": 2,
      "dose_amount": 3000,
      "qty": 1,
      "meduesunit": 151,
      "meduestype": "IV1"
    }
  ]
}
```

### 5.5 API 2 Success Response

```json
{
  "status": "SUCCESS",
  "message": "Drug order received",
  "timestamp": "2026-04-01T09:30:05"
}
```

### 5.6 API 2 Error Response

```json
{
  "status": "ERROR",
  "error_code": "INVALID_REQUEST",
  "error_message": "Drug order payload is invalid"
}
```

## 6. SOAP API 2 Request Example

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:his="http://tempuri.org/">
  <soapenv:Header/>
  <soapenv:Body>
    <his:PostDrugOrder>
      <his:hn>1234567</his:hn>
      <his:vn>6704010001</his:vn>
      <his:order_datetime>2026-04-01T09:30:00</his:order_datetime>
      <his:doctor_code>7275524</his:doctor_code>
      <his:clinic_code>1004</his:clinic_code>
      <his:diag>N185</his:diag>
      <his:order_items>
        <his:DrugOrderItem>
          <his:med_item>8197</his:med_item>
          <his:price>0.00</his:price>
          <his:pack_sequence>1</his:pack_sequence>
          <his:dose_amount>3000</his:dose_amount>
          <his:qty>1</his:qty>
          <his:meduesunit>151</his:meduesunit>
          <his:meduestype>IV1</his:meduestype>
        </his:DrugOrderItem>
      </his:order_items>
    </his:PostDrugOrder>
  </soapenv:Body>
</soapenv:Envelope>
```
