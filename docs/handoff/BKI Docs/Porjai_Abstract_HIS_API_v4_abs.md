# Porjai - HIS Integration API Specification

Version 4.0

Profile: Abstract HIS Integration

Protocol: REST API / SOAP Web Service

Format: JSON / XML

Encoding: UTF-8

Timezone: Asia/Bangkok (UTC+7)

## V4 Changes From PDF Comments

- API 1 date response keeps explicit `YYYY-MM-DD` format for `dob`.
- API 2 `diag` is moved from each `order_items` row to the order header.
- API 2 keeps clear field names `route_of_admin` and `dose_unit`; the PDF notes are treated as HIS-side meaning, not literal API field names.
- API 2 `med_ned` sends the numeric MEDNED value, not the letter code.
- In nearest-available-pack mapping, `dose_amount` sends the quantity ordered by the doctor, not the substituted pack strength.

## 1. Overview

This document defines the abstract integration contract between Porjai middleware and Hospital Information System (HIS).

This version contains 2 APIs:

- API 1: Porjai sends HN and receives patient demographic, visit, clinic, doctor, and coverage information.
- API 2: Porjai sends drug order data from Porjai to HIS.

Drug ordering is based on ABS mapping. Porjai may map from HIS Code ABS internally, but the outbound order payload must send `med_item`.

For pharmacy-facing order lines, `dose_amount` must represent the quantity ordered by the doctor. If Porjai maps a non-exact clinical request to a different available pack, keep the doctor-ordered quantity in `dose_amount` and use `med_item` to identify the actual HIS item being ordered.

## 2. Technical Requirement

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

Porjai posts HN to Abstract HIS and receives patient information in return.

### 3.1 Request Fields

| Field Name | Type | Description | Example | Remark |
| --- | --- | --- | --- | --- |
| hn | string | Hospital Number | 1234567 | Required |

### 3.2 Response Fields

| Field Name | Type | Description | Example | Remark |
| --- | --- | --- | --- | --- |
| hn | string | Hospital Number | 1234567 |  |
| visit_no | string | Visit Number | 6704010001 |  |
| en_firstname | string | Patient first name in English | PORJAI |  |
| en_lastname | string | Patient last name in English | JAIDEE |  |
| th_firstname | string | Patient first name in Thai | พอใจ |  |
| th_lastname | string | Patient last name in Thai | ใจดี |  |
| gender | string | Gender | M |  |
| dob | date | Date of birth | 1980-05-15 | YYYY-MM-DD |
| clinic_code | string | Clinic code | BKI-DIA |  |
| clinic_name | string | Clinic name | Kidney Clinic |  |
| doctor_code | string | Doctor code | 7275524 |  |
| doctor_name | string | Doctor name | DR. NITINAN |  |
| coverage_code | string | Coverage code | OFC |  |
| coverage_name | string | Coverage name | Out-of-pocket |  |

## 4. API 2: Send Drug Order To HIS

Porjai sends a drug order payload to Abstract HIS.

### 4.1 Request Fields

| Field Name | Type | Description | Example | Remark |
| --- | --- | --- | --- | --- |
| hn | string | Hospital Number | 1234567 |  |
| vn | string | Visit Number | 6704010001 |  |
| order_datetime | datetime | Drug order datetime | 2026-04-01T09:30:00 | ISO 8601 |
| doctor_code | string | Doctor code | 7275524 |  |
| clinic_code | string | Clinic code | BKI-DIAL |  |
| coverage_code | string | Coverage code | OFC |  |
| diag | string | Diagnosis code | N185 | Header-level field |
| notes | string | Order note | Dialysis medication order | Optional |
| order_items | array | Drug order item list | [...] | At least 1 item |

### 4.2 order_items Fields

| Field Name | Type | Description | Example | Remark |
| --- | --- | --- | --- | --- |
| med_item | number | HIS meditem code used for ordering | 8197 |  |
| price | number | Unit price | 0.00 | Optional unless HIS requires it |
| pack_sequence | number | Pack sequence from ABS mapping sheet | 1 | Map from PACKSEQ |
| dispense_unit | string | Dispense unit | Prefilled syringe | Use ABS drug master wording |
| dose_amount | number | Quantity ordered by the doctor | 3000 | Keep doctor-ordered quantity |
| dose_unit | string | Dose unit | IU |  |
| route_of_admin | string | Route / medication use type | Intravenous |  |
| med_ned | number | MEDNED reason number from Excel MEDNED column | 8 | Optional; send numeric MEDNED value 3-8 when required. Do not send A-F in this field. |

### 4.3 MEDNED Reference From Excel

Use the numeric value in the `MEDNED` column for API field `med_ned`. The `CODE` column is a reference label only.

| MEDNED | Meaning | CODE |
| --- | --- | --- |
| 3 | เกิดอาการไม่พึงประสงค์จากยาหรือแพ้ยาที่สามารถใช้ได้ในบัญชียาหลักแห่งชาติ | A |
| 4 | ผลการรักษาไม่บรรลุเป้าหมายแม้ว่าได้ใช้ยาในบัญชียาหลักแห่งชาติครบตามมาตรการรักษาแล้ว | B |
| 5 | ไม่มียาในบัญชียาหลักให้ใช้ แต่ผู้ป่วยมีข้อบ่งชี้การใช้ยานี้ ตามข้อบ่งใช้ที่ได้ขึ้นทะเบียนไว้กับสำนักงานคณะกรรมการอาหารและยา | C |
| 6 | ผู้ป่วยมีภาวะหรือโรคที่ห้ามใช้ยาในบัญชีอย่างสัมบูรณ์ (Absolute Contraindication) หรือมีข้อห้ามการใช้ยาในบัญชีร่วมกับยาอื่นที่ผู้ป่วยจำเป็นต้องใช้อย่างหลีกเลี่ยงไม่ได้ | D |
| 7 | ยาในบัญชียาหลักแห่งชาติที่มีราคาแพงกว่า (ในเชิงความคุ้มค่า) | E |
| 8 | ผู้ป่วยแสดงความจำนงต้องการ (เบิกไม่ได้) | F |

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
    "gender": "M",
    "dob": "1980-05-15",
    "clinic_code": "BKI-DIA",
    "clinic_name": "Kidney Clinic",
    "doctor_code": "7275524",
    "doctor_name": "DR. NITINAN",
    "coverage_code": "OFC",
    "coverage_name": "Out-of-pocket"
  }
}
```

### 5.3 API 1 Error Response

```json
{
  "status": "NOT_FOUND",
  "error_message": "Patient VN not found",
  "data": {
    "hn": "1234567"
  }
}
```

### 5.4 API 2 Exact-Match Example

Mapped from shift order: Eprex 3000 Intravenous Prefilled syringe -> HIS Code ABS 3EPRE3000 -> med_item 8197.

```json
{
  "hn": "1234567",
  "vn": "6704010001",
  "order_datetime": "2026-04-01T09:30:00",
  "doctor_code": "7275524",
  "clinic_code": "BKI-DIAL",
  "coverage_code": "OFC",
  "diag": "N185",
  "notes": "Medical order from dialysis shift sheet: Eprex 3000 Intravenous Prefilled syringe",
  "order_items": [
    {
      "med_item": 8197,
      "price": 0.00,
      "pack_sequence": 1,
      "dispense_unit": "Prefilled syringe",
      "dose_amount": 3000,
      "dose_unit": "IU",
      "route_of_admin": "Intravenous"
    }
  ]
}
```

### 5.5 API 2 Split-Pack Example

Requested dose 8,000 IU has no exact Binocrit pack. Split using 3BINO5000 -> med_item 39800 and 3BINO3000 -> med_item 39799.

```json
{
  "hn": "1234567",
  "vn": "6704010001",
  "order_datetime": "2026-04-01T09:45:00",
  "doctor_code": "7275524",
  "clinic_code": "BKI-DIAL",
  "coverage_code": "OFC",
  "diag": "N185",
  "notes": "Requested dose 8,000 IU. HIS has no exact Binocrit 8,000 pack, so split by ABS mapping.",
  "order_items": [
    {
      "med_item": 39800,
      "price": 0.00,
      "pack_sequence": 1,
      "dispense_unit": "Prefilled syringe",
      "dose_amount": 5000,
      "dose_unit": "IU",
      "route_of_admin": "Intravenous"
    },
    {
      "med_item": 39799,
      "price": 0.00,
      "pack_sequence": 2,
      "dispense_unit": "Prefilled syringe",
      "dose_amount": 3000,
      "dose_unit": "IU",
      "route_of_admin": "Intravenous"
    }
  ]
}
```

### 5.6 API 2 Nearest-Available-Pack Example

Requested dose 9,000 IU has no exact Hemax pack in ABS. If Porjai chooses the available 10,000 IU Hemax row 3HEMA10000 -> med_item 15733, the order line still sends `dose_amount` 9000 because that is the quantity ordered by the doctor.

```json
{
  "hn": "1234567",
  "vn": "6704010001",
  "order_datetime": "2026-04-01T10:00:00",
  "doctor_code": "7275524",
  "clinic_code": "BKI-DIAL",
  "coverage_code": "OFC",
  "diag": "N185",
  "notes": "Requested dose 9,000 IU. HIS only has Hemax 10,000 vial, so med_item 15733 is used while dose_amount remains the doctor-ordered quantity.",
  "order_items": [
    {
      "med_item": 15733,
      "price": 0.00,
      "pack_sequence": 1,
      "dispense_unit": "Vial",
      "dose_amount": 9000,
      "dose_unit": "IU",
      "route_of_admin": "Intravenous",
      "med_ned": 8
    }
  ]
}
```

### 5.7 API 2 Success Response

```json
{
  "status": "SUCCESS",
  "message": "Drug order received",
  "timestamp": "2026-04-01T09:30:05"
}
```

### 5.8 API 2 Error Response

```json
{
  "status": "ERROR",
  "error_code": "INVALID_REQUEST",
  "error_message": "Drug order payload is invalid"
}
```

## 6. SOAP Web Service Examples

### 6.1 API 1 Request

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:his="http://tempuri.org/">
  <soapenv:Header/>
  <soapenv:Body>
    <his:GetPatientInfoByHN>
      <his:hn>1234567</his:hn>
    </his:GetPatientInfoByHN>
  </soapenv:Body>
</soapenv:Envelope>
```

### 6.2 API 1 Success Response

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetPatientInfoByHNResponse xmlns="http://tempuri.org/">
      <GetPatientInfoByHNResult>
        <status>SUCCESS</status>
        <hn>1234567</hn>
        <visit_no>6704010001</visit_no>
        <en_firstname>PORJAI</en_firstname>
        <en_lastname>JAIDEE</en_lastname>
        <th_firstname>พอใจ</th_firstname>
        <th_lastname>ใจดี</th_lastname>
        <gender>M</gender>
        <dob>1980-05-15</dob>
        <clinic_code>BKI-DIAL</clinic_code>
        <clinic_name>Kidney Clinic</clinic_name>
        <doctor_code>7275524</doctor_code>
        <doctor_name>DR. NITINAN</doctor_name>
        <coverage_code>OFC</coverage_code>
        <coverage_name>Out-of-pocket</coverage_name>
      </GetPatientInfoByHNResult>
    </GetPatientInfoByHNResponse>
  </soap:Body>
</soap:Envelope>
```

### 6.3 API 1 Error Response

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetPatientInfoByHNResponse xmlns="http://tempuri.org/">
      <GetPatientInfoByHNResult>
        <status>NOT_FOUND</status>
        <hn>1234567</hn>
        <error_message>Patient not found</error_message>
      </GetPatientInfoByHNResult>
    </GetPatientInfoByHNResponse>
  </soap:Body>
</soap:Envelope>
```

### 6.4 API 2 Request

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
      <his:clinic_code>BKI-DIAL</his:clinic_code>
      <his:coverage_code>OFC</his:coverage_code>
      <his:diag>N185</his:diag>
      <his:notes>Exact-match sample using Eprex 3000 from dialysis shift sheet</his:notes>
      <his:order_items>
        <his:DrugOrderItem>
          <his:med_item>8197</his:med_item>
          <his:price>0.00</his:price>
          <his:pack_sequence>1</his:pack_sequence>
          <his:dispense_unit>Prefilled syringe</his:dispense_unit>
          <his:dose_amount>3000</his:dose_amount>
          <his:dose_unit>IU</his:dose_unit>
          <his:route_of_admin>Intravenous</his:route_of_admin>
        </his:DrugOrderItem>
      </his:order_items>
    </his:PostDrugOrder>
  </soapenv:Body>
</soapenv:Envelope>
```

### 6.5 API 2 Success Response

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <PostDrugOrderResponse xmlns="http://tempuri.org/">
      <PostDrugOrderResult>
        <status>SUCCESS</status>
        <message>Drug order received</message>
        <timestamp>2026-04-01T09:30:05</timestamp>
      </PostDrugOrderResult>
    </PostDrugOrderResponse>
  </soap:Body>
</soap:Envelope>
```

### 6.6 API 2 Error Response

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <PostDrugOrderResponse xmlns="http://tempuri.org/">
      <PostDrugOrderResult>
        <status>ERROR</status>
        <error_code>INVALID_REQUEST</error_code>
        <error_message>Drug order payload is invalid</error_message>
      </PostDrugOrderResult>
    </PostDrugOrderResponse>
  </soap:Body>
</soap:Envelope>
```
