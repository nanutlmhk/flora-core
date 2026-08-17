# BR Kidney Software Specification
## TDMS Shift Report, HIS Patient Lookup, Coverage Check, and Drug Order Integration

Version: Draft 1.0  
Date: 3 July 2026  
Owner: Porjai / Aidas Team  
Profile: BR Kidney / Abstract HIS Integration

---

## 1. Purpose

This document defines the software specification for the BR Kidney workflow that needs to:

1. receive or import shift reports from TDMS in PDF / Excel format
2. retrieve patient information from HIS
3. evaluate or check patient coverage information
4. support drug order creation per patient
5. send drug order data from Porjai software to HIS

This specification is intended to provide a clear development and discussion baseline between:

- Porjai development
- hospital users
- hospital IT
- HIS / Abstract integration team

---

## 2. Scope Summary

The target workflow combines document intake, patient lookup, clinical order preparation, and HIS submission.

### In scope

- import of TDMS shift report files
- extraction / import of patient list from TDMS source files
- patient lookup by HN against HIS API
- coverage / benefit check from HIS response
- patient-level drug order preparation
- medication mapping to HIS drug item structure
- posting drug order API to HIS
- status tracking and error logging

### Out of scope for initial version

- direct billing / claim submission
- automatic medication recommendation engine
- full dialysis clinical documentation module
- replacing TDMS entirely
- replacing HIS order-entry ownership
- advanced reconciliation with pharmacy dispensing result unless HIS returns that API explicitly

---

## 3. Business Goal

The business goal is to reduce manual work and ordering mistakes in the dialysis workflow by using one structured software path:

1. load shift report / patient batch from TDMS
2. confirm patient identity and current visit from HIS
3. check patient coverage for classification
4. create drug order using mapped HIS-compatible items
5. send order to HIS with traceable result

This should improve:

- order consistency
- reduction of repeated manual entry
- better audit trail
- easier support for staff at dialysis clinic

---

## 4. High-Level Workflow

### 4.1 Main workflow

1. User imports TDMS shift report file
2. System parses patient rows from PDF or Excel source
3. System creates or stages a working patient list for that shift
4. User selects a patient
5. System calls HIS patient API by HN
6. System displays patient demographics, visit, clinic, doctor, and coverage
7. System checks coverage classification rules
8. User creates or reviews drug order
9. System maps local medication selection to HIS order items
10. System validates required fields
11. System sends drug order API to HIS
12. System records request/response result and submission status

### 4.2 Alternative / recovery paths

- if TDMS file parsing fails, user can correct file and re-import
- if HIS patient lookup fails, user can retry later without losing imported shift data
- if HIS is unavailable, order can remain in draft / pending state
- if API order submission fails, request must be logged and retryable

---

## 5. Functional Modules

### 5.1 TDMS Shift Report Import

#### Objective

Allow staff to import TDMS shift report data from PDF or Excel.

#### Input formats

- PDF shift report exported from TDMS
- Excel shift report exported from TDMS

#### Functional behavior

- user selects a source file
- system detects file type
- system parses patient rows and key shift data
- system stores imported rows into a staging dataset
- system marks invalid or incomplete rows for review

#### Minimum fields expected from TDMS source

These are working assumptions and must be confirmed with real files:

- HN
- patient name
- treatment date
- shift / session
- machine / station if available
- attending doctor if available
- planned medication-related fields if present

#### Notes

- Excel import is expected to be more reliable than PDF parsing
- PDF import may require template-specific extraction rules
- the software should support keeping the original imported file for audit

---

### 5.2 HIS Patient Lookup API

#### Objective

Retrieve current patient and visit context from HIS by HN.

#### External dependency

Use the existing integration direction described in:
[Porjai_Abstract_HIS_API_v5_draft.md](C:/Users/onlys/Aidas/docs/Porjai_Abstract_HIS_API_v5_draft.md)

#### Request

- key input: `hn`

#### Expected response fields

- `hn`
- `visit_no`
- `en_firstname`
- `en_lastname`
- `th_firstname`
- `th_lastname`
- `gender`
- `dob`
- `clinic_code`
- `clinic_name`
- `doctor_code`
- `doctor_name`
- `coverage_code`
- `coverage_name`

#### Functional behavior

- system calls HIS API when user selects or opens a patient from imported shift list
- system displays returned patient context
- system caches the response for the working session
- system clearly shows if the lookup result is stale, failed, or pending

---

### 5.3 Coverage Check

#### Objective

Use HIS coverage information to classify the patient for ordering workflow or business rule decisions.

#### Input

- `coverage_code`
- `coverage_name`

#### Functional behavior

- system reads coverage information from HIS patient API response
- system applies configured coverage classification rules
- system displays the coverage status clearly to the user
- system may use this for:
  - display / warning only
  - filtering which order patterns are allowed
  - reporting / audit

#### Important boundary

Coverage information is received from HIS and is used for classification logic.
Coverage is **not** sent back as part of the drug order API unless HIS later requires it explicitly.

---

### 5.4 Drug Order Creation Per Patient

#### Objective

Allow user to create a drug order for one patient using local clinical input and mapped HIS order items.

#### Functional behavior

- user opens patient order screen
- system shows current patient / visit / clinic / doctor / coverage context
- user selects medication(s)
- user enters or confirms dose
- system calculates matching HIS item combination
- system builds one or more order rows

#### Core requirements

- one patient can have one or more drug order rows
- one clinical dose may map to one or more HIS item rows
- draft order must remain editable before submission
- system must validate required fields before send

#### Required order-level fields

- HN
- visit number / VN
- order datetime
- doctor code
- clinic code
- diagnosis code if required

#### Required item-level fields

- HIS medication item code
- dose amount
- quantity
- unit code (`meduesunit`)
- administration/type code (`meduestype`)
- pack sequence if needed by mapping
- optional price / MEDNED-related fields if required by HIS

---

### 5.5 Drug Mapping Layer

#### Objective

Translate the local medication/order model into the exact HIS-compatible item format.

#### Input sources

Based on the current integration draft and received master files:

- `medinterface.xlsx`
- `meduseunit.xls`
- `medusertype.xls`

#### Functional behavior

- map selected local drug to HIS `med_item`
- map clinical unit to `meduesunit`
- map administration route/type to `meduestype`
- determine `qty` from available HIS package/item structure

#### Important example

One dose may require split items.

Example:
- requested dose: 8,000 IU
- available HIS items:
  - 5,000 IU item × 1
  - 3,000 IU item × 1

The system must support multi-row item generation for one clinical order.

---

### 5.6 Send Drug Order API to HIS

#### Objective

Submit prepared drug order payload to HIS and record submission result.

#### External dependency

Use the API 2 contract from:
[Porjai_Abstract_HIS_API_v5_draft.md](C:/Users/onlys/Aidas/docs/Porjai_Abstract_HIS_API_v5_draft.md)

#### Functional behavior

- system builds final payload
- system sends payload to HIS
- system stores:
  - request timestamp
  - request payload snapshot
  - response payload snapshot
  - success / failure status
  - retry state if failed

#### Expected send behavior

- timeout should be configurable
- retry should be limited to safe cases like network failure
- duplicate submission risk must be controlled

#### Duplicate protection

The system must not silently resubmit the same order multiple times without clear status.
At minimum, it should track:

- draft
- sending
- sent success
- sent failed
- retry pending

---

## 6. Data Model Direction

This workflow likely needs at least these logical entities:

### 6.1 Shift import

- shift import batch
- imported source file
- imported patient row

### 6.2 HIS patient context

- patient cache
- visit cache
- coverage cache

### 6.3 Drug order

- drug order header
- drug order item
- order submission log
- order error / retry log

### 6.4 Mapping masters

- HIS medication item mapping
- unit mapping
- use-type mapping

---

## 7. UI / User Flow Requirements

### 7.1 Shift import screen

Should allow:

- upload / select TDMS PDF or Excel
- preview imported rows
- show invalid rows
- select patient

### 7.2 Patient order screen

Should show:

- patient identity
- current visit information
- clinic
- doctor
- coverage
- draft order rows
- submission status

### 7.3 Submission result

Should show:

- success message from HIS
- failure reason from HIS
- clear status for each patient order

---

## 8. Validation Rules

Minimum validations before sending order:

- HN must exist
- VN / visit number must exist
- clinic code must exist
- doctor code must exist
- at least one order item must exist
- each order item must have:
  - `med_item`
  - `dose_amount`
  - `qty`
  - `meduesunit`
  - `meduestype`

Additional business validations to confirm:

- whether order is restricted to dialysis clinics only
- whether some coverage classes require different handling
- whether diagnosis code is mandatory for all orders

---

## 9. Logging and Audit

The system should keep an auditable trail for:

- source file import
- patient lookup requests
- HIS responses
- draft order creation
- final order submission
- submission failures and retries

Recommended audit fields:

- user
- workstation
- timestamp
- patient HN
- visit number
- action type
- payload snapshot
- result status

---

## 10. Error Handling

### 10.1 TDMS import errors

- unsupported file format
- unreadable PDF / Excel
- missing required patient fields

### 10.2 HIS lookup errors

- patient not found
- no active visit
- timeout
- gateway unavailable

### 10.3 Drug mapping errors

- no matching HIS drug item
- ambiguous unit mapping
- ambiguous administration/type mapping

### 10.4 Submission errors

- invalid payload
- HIS validation failure
- duplicate order rejection
- timeout / network error

Each error should be visible to the user and preserved in logs.

---

## 11. Security and Access

Minimum expectations:

- only authorized users can create/send drug orders
- HIS credentials or tokens must not be exposed in frontend code
- request/response logs containing PHI should be protected
- imported source files should be stored in controlled application storage if archived

---

## 12. Open Questions for Confirmation

These points still need formal confirmation with hospital / HIS team:

1. What exact TDMS PDF and Excel layouts will be used?
2. Is HN always present and reliable in TDMS source files?
3. Can one imported shift row ever refer to more than one active visit?
4. What exact API field names does Abstract require for `meduesunit` and `meduestype`?
5. Is `diag` mandatory in every outbound drug order?
6. What is the duplicate-order prevention rule in HIS?
7. Does HIS return an official order number after successful submission?
8. Is order cancel / void / amend API required in phase 1?
9. What is the exact business meaning of coverage check in this workflow:
   - display only
   - validation gate
   - pricing / class logic
10. Are drug orders restricted to clinic codes `1004`, `1005`, `1006` only?

---

## 13. Suggested Phase Plan

### Phase 1

- Excel import first
- HIS patient lookup
- coverage display/check
- single-patient drug order draft
- send order to HIS

### Phase 2

- PDF import hardening
- better batch workflow
- retry / reconciliation tools
- improved audit and dashboarding

### Phase 3

- advanced order history / reconciliation
- analytics / reporting
- deeper integration with surrounding dialysis workflow

---

## 14. Summary

This BR Kidney software should act as a controlled integration workflow between TDMS operational input and Abstract HIS ordering.

The core capability is:

- import shift patient data
- retrieve patient and coverage context from HIS
- prepare valid mapped drug orders
- send those orders to HIS with clear status and auditability

The most critical implementation risks are:

- real TDMS file variability
- medication mapping correctness
- duplicate order prevention
- business interpretation of coverage rules

---

## 15. Related Documents

- [Porjai_Abstract_HIS_API_v5_draft.md](C:/Users/onlys/Aidas/docs/Porjai_Abstract_HIS_API_v5_draft.md)
- [AIDAS-Next-Developer-Brief.md](C:/Users/onlys/Aidas/docs/AIDAS-Next-Developer-Brief.md)

