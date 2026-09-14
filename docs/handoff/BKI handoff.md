# BKI / BR Kidney Project Handoff

Last evidence review: 30 July 2026

Hospital: Bangkok Kidney Institute / BR Kidney / สถาบันโรคไตภูมิราชนครินทร์

Systems: TDMS/TSS dialysis data, Porjai middleware/Hidro, Abstract HIS, drug
mapping, patient/visit lookup, and drug-order submission

## 1. Executive Summary

The local BKI material represents two related but different stages:

1. `March 2026 prototype`: a local React/Express application that uploads a
   dialysis-treatment XML file, parses it, and renders a treatment-review page.
2. `May-July 2026 target workflow`: import TDMS PDF/Excel shift data, look up the
   patient/visit/coverage in Abstract HIS, construct mapped per-patient drug
   orders, submit them to HIS, and retain auditable status/error evidence.

The March prototype is not evidence that the July drug-order scope is complete.
It has no HIS integration, authentication, durable database, automated tests,
deployment manifest, or production security controls.

Latest available status:

- `Last documented, 30 May 2026`: the Porjai side was described as completed,
  while the HIS side still needed completion/testing; a case where one patient
  can have more than one prescription/order was still being corrected.
- `Verified, 3 July 2026`: detailed software specification and draft UAT/
  acceptance material were created.
- `Not evidenced`: confirmed final API contract, completed production build,
  signed UAT, go-live, deployment inventory, or production support record.

Treat the project as `integration/UAT status unverified`.

## 2. Target Business Workflow

The July specification defines this end-to-end path:

1. Import the latest TDMS shift report in Excel or supported PDF format.
2. Parse patient rows into a shift/batch staging area.
3. Select a patient and call HIS by HN.
4. Receive current visit, clinic, doctor, and coverage context.
5. Classify/display coverage without sending it back in the drug-order payload.
6. Create or review one or more drug-order rows for the patient.
7. Map local aliases/doses to Abstract HIS medication items, pack sequence,
   use-unit code, administration/use-type code, and MEDNED reason when required.
8. Validate all required fields and block missing/ambiguous mappings.
9. Submit the order to HIS.
10. Store request, response, status, retry state, and source-file traceability.

Initial scope excludes billing/claim submission, automatic clinical
recommendations, replacement of TDMS, replacement of HIS order ownership, and
pharmacy-dispensing reconciliation unless HIS supplies a confirmed interface.

## 3. API Contract - Current Draft

The most complete local contract is
`Porjai_Abstract_HIS_API_v5_draft.md`, version 5.0 Draft for Confirmation.

### API 1 - patient lookup by HN

Request key:

- `hn`

Expected context returned:

- HN and visit number;
- Thai/English name, gender, and date of birth;
- clinic code/name;
- doctor code/name;
- coverage code/name.

Working dialysis clinic codes in the draft are `1004`, `1005`, and `1006`.
The HIS owner must confirm that the list is complete and whether orders must be
restricted to those values.

### API 2 - submit drug order

Header fields in the current draft:

- `hn`;
- `vn`;
- `order_datetime`;
- `doctor_code`;
- `clinic_code`;
- `diag`;
- `order_items`.

Current item fields:

- `med_item`;
- optional `price`;
- `pack_sequence`;
- `dose_amount`;
- `qty`;
- `meduesunit`;
- `meduestype`;
- conditional `med_ned`.

The draft intentionally removes free-text notes from API 2 and states that
coverage is received for classification only, not returned in the order.

### Unresolved contract items

Abstract HIS must confirm:

- REST versus SOAP endpoint actually used;
- authentication method and secret-delivery process;
- exact field spellings `meduesunit` and `meduestype`;
- active use-unit codes, especially the working `UNIT/IU` code;
- clinic restrictions;
- required diagnosis, doctor, price, MEDNED, and order identifiers;
- success response/order reference and duplicate-detection semantics;
- whether retry after timeout can create duplicate orders;
- reconciliation/cancellation/amendment behavior;
- one patient with multiple prescriptions/orders.

The draft's 60-second timeout and three network-only retries are proposed
requirements, not confirmed production behavior.

## 4. Medication and Clinical Mapping

Authoritative working files are under `C:\Users\onlys\OneDrive\เอกสาร`:

- `medinterface.xlsx`: drug, HIS item, pack sequence, MEDNED, dialysis ICD-10,
  and master data.
- `meduseunit.xls`: HIS use/dose-unit codes.
- `medusertype.xls`: administration/use-type codes.
- `เส้นส่ง med interface พอใจ_ABS.xlsx`: earlier mapping/reference workbook.

Important rules:

- Never submit a drug without an approved active HIS item mapping.
- Treat discontinued drugs as blocked.
- Preserve leading zeros and string semantics for identifiers.
- `qty` is the number of selected HIS packages/items, not the prescribed dose.
- One clinical dose may produce multiple HIS rows; for example, an 8,000 IU
  dose may use 5,000 IU plus 3,000 IU packages.
- `meduesunit` comes from the use-unit master.
- `meduestype` comes from the use-type master and must represent the precise
  route/instruction, not a loose text match.
- MEDNED/off-list reason rules require hospital/pharmacy confirmation.
- The working dialysis diagnosis reference includes N185, but mandatory
  diagnosis behavior must be confirmed.

Mapping changes must be versioned, reviewed by the appropriate clinical/
pharmacy owner, tested with positive and negative cases, and tied to an effective
date.

## 5. March XML Review Prototype

Local source:

`C:\Users\onlys\OneDrive\รูปภาพ\brkidney-hidro`

Archive:

`C:\Users\onlys\Downloads\brkidney-hidro-20260306T030129Z-1-001.zip`

The folder is not a Git repository.

### Runtime

- Frontend: React 18, Vite 4, Tailwind CSS.
- Backend: Node.js, Express, Multer, `fast-xml-parser`.
- Backend start: run `npm start` inside `backend`; listens on port `4000`.
- Frontend start: run `npm run dev` inside `frontend`.
- Frontend posts uploaded XML to `http://localhost:4000/upload`.
- A debug endpoint, `/debug-xml`, returns the raw parsed XML structure.

### Functional behavior

- Accepts an uploaded XML file.
- Parses selected dialysis sections.
- Displays patient, vascular access, treatment, machine, anticoagulation,
  intra-dialysis, drugs, checklist, and comments.
- Allows parsed JSON download.

### Critical limitations

- No authentication or authorization.
- CORS is broadly enabled.
- No file-size/type validation is evident.
- Debug endpoint can expose the complete uploaded clinical structure.
- No durable application database or audit trail.
- No HIS patient lookup or drug-order submission.
- No automated tests; backend `npm test` intentionally fails.
- Frontend endpoint is hard-coded to localhost.
- `server.js` and `parser.js` assume different XML root shapes.
- No `.env`/deployment contract, service definition, health check, or backup
  procedure was found.
- No Git history is available in the extracted folder.
- Real-looking patient identifiers and names appear in sample XML and
  `frontend/src/mock/hdScenarios.js`.

This prototype must not be published or deployed as-is.

## 6. Sensitive Local Data

The prototype `backend\uploads` directory contains:

- 30 XML files;
- 12 unique content hashes;
- approximately 4.6 MB total;
- multiple duplicate copies under original and generated filenames.

The XML files contain treatment and patient-identifiable content. The
`HN_VN_Request.xlsx` workbook contains 129 named dialysis patients and is also
PHI-sensitive.

Required handling:

- keep access restricted;
- do not commit to GitHub;
- do not use in screenshots, demos, tickets, chat, or external test systems;
- create de-identified synthetic fixtures before automated testing;
- follow the hospital-approved retention/deletion decision;
- rotate any credential if one is ever discovered in logs or source.

## 7. Data Model and State

The target application should maintain, at minimum:

- shift import batch;
- original source-file reference and checksum;
- imported patient row and validation state;
- cached HIS patient/visit/coverage context with freshness;
- drug-order header and item rows;
- mapping-master version used;
- request/response submission log;
- explicit order states: draft, sending, sent-success, sent-failed, and
  retry-pending;
- error/retry history and correlation identifier.

The raw request/response log is PHI. Protect it with least-privilege access,
retention controls, and redaction in operational views.

## 8. Safety and Duplicate-Order Controls

Before production:

- define an idempotency/correlation strategy with HIS;
- never automatically retry an ambiguous timeout without reconciliation;
- prevent double-click/multi-process duplicate submission;
- show the user whether the source row is unsent, sending, accepted, rejected, or
  unknown;
- require review where one patient has multiple order sheets;
- block missing, inactive, or ambiguous mappings;
- retain the exact source batch and mapping version for each order;
- separate transport success from clinical/HIS acceptance;
- support controlled correction without silently overwriting audit history.

## 9. UAT and Acceptance

The July draft UAT workbook covers:

- installation and service control;
- TDMS Excel and PDF import;
- invalid-file handling;
- master mapping;
- patient lookup and coverage/visit display;
- draft order creation;
- split-dose mapping;
- missing-mapping prevention;
- HIS submission;
- source-to-response traceability;
- HIS/network/source-data failure cases;
- status/logs, monitoring, performance, documentation, training, support, and
  final acceptance.

No signed result was found. The successor must obtain evidence for every row and
use statuses that distinguish application pass/fail from pending external HIS
confirmation.

## 10. Takeover Procedure

1. Secure the source and sensitive files in approved private storage.
2. Create a clean Git repository from source only; exclude uploads, build output,
   secrets, and real-patient mock data.
3. Replace real-looking fixtures with synthetic cases.
4. Reconcile the March prototype against the July software specification and
   identify reusable parser/UI work.
5. Obtain the final API contract and test endpoint from the Abstract HIS owner.
6. Import and version the approved mapping masters.
7. Implement durable state, authentication, authorization, audit, idempotency,
   and deployment configuration.
8. Add parser, mapping, API contract, failure, and duplicate-order tests.
9. Run the July UAT checklist with hospital-approved synthetic/test patients.
10. Obtain signed clinical, HIS, pharmacy, IT, and project acceptance.
11. Record production host/version/configuration, backup, monitoring, support,
    rollback, and change-control ownership.

## 11. Owner-Based Questions

The successor should direct unresolved facts to:

- BKI dialysis/clinical owner: workflow, multiple order sheets, user roles,
  source-export timing, and acceptance.
- Abstract HIS owner: endpoints, fields, authentication, responses, duplicate
  behavior, cancellation, and reconciliation.
- BKI pharmacy/master-data owner: active drugs, units, routes/use types, MEDNED,
  discontinued items, and effective dates.
- BKI IT/security: host, network, TLS, secrets, accounts, logging, backup,
  retention, monitoring, and deployment authority.
- Porjai project owner: current branch/build, configuration, latest test record,
  open defects, release artifact, and support roster.

### Mandatory VPN/security boundary

All BKI VPN, credentials, MFA, certificates, API secrets, private endpoints,
database access, firewall, routing, allowlist, and remote-support information
must be requested directly from BKI IT/security.

No security secret is supplied through this handoff. The outgoing developer
will provide security information only to authorized hospital IT personnel.
BKI IT must validate the successor, approve the access scope, provision the
account/profile, and communicate the permitted configuration through its own
secure channel.

## 12. Source Material

Copied-document folder:

`C:\Users\onlys\Flora\docs\handoff\BKI Docs`

The folder is flat and contains documents only. Local timestamps use
Asia/Bangkok (`UTC+7`). The original sources remain in place. Some BKI
spreadsheets contain patient-identifiable information and require
hospital-approved access controls.

| Document in `BKI Docs` | Original source path(s) | Local timestamp(s) |
| --- | --- | --- |
| `BRKidney-HIS-Drug-Order-Software-Spec.md` | `C:\Users\onlys\Flora\docs\BRKidney-HIS-Drug-Order-Software-Spec.md` | `2026-07-03T11:56:16+07:00` |
| `BRKidney-HIS-Drug-Order-UAT-Plan.md` | `C:\Users\onlys\Flora\docs\BRKidney-HIS-Drug-Order-UAT-Plan.md` | `2026-07-03T14:28:42+07:00` |
| `coverrqage.xls` | `C:\Users\onlys\OneDrive\เอกสาร\coverrqage.xls` | `2026-05-28T10:07:53+07:00` |
| `fkpj-meeting-report-2026-05-30.md` | `C:\Users\onlys\Flora\fkpj-meeting-report-2026-05-30.md` | `2026-06-21T16:23:17+07:00` |
| `HANDOFF-HOSPITAL-CONTEXT.md` | `C:\Users\onlys\Flora\docs\HANDOFF-HOSPITAL-CONTEXT.md` | `2026-07-21T12:08:11+07:00` |
| `HANDOFF-RISKS-AND-OPEN-QUESTIONS.md` | `C:\Users\onlys\Flora\docs\HANDOFF-RISKS-AND-OPEN-QUESTIONS.md` | `2026-07-21T12:08:11+07:00` |
| `HIS_Interface_Requirements.docx` | `C:\Users\onlys\Downloads\HIS_Interface_Requirements.docx` | `2026-03-24T18:56:27+07:00` |
| `HIS_Table_Spec.xlsx` | `C:\Users\onlys\Downloads\HIS_Table_Spec.xlsx` | `2026-03-25T11:10:37+07:00` |
| `HN_VN_Request.xlsx` | `C:\Users\onlys\Downloads\HN_VN_Request.xlsx` | `2026-03-24T19:32:28+07:00` |
| `Medical-Device-Integration-Handover-Checklist-Response.md` | `C:\Users\onlys\Flora\docs\Medical-Device-Integration-Handover-Checklist-Response.md` | `2026-07-21T13:11:15+07:00` |
| `Medical-Device-Integration-Handover-Checklist-Response.pdf` | `C:\Users\onlys\Downloads\Medical-Device-Integration-Handover-Checklist-Response.pdf` | `2026-07-21T14:15:11+07:00` |
| `MedicalOrdersPerShift_LpcXl1CaREiNNks8kI9-2g.xls` | `C:\Users\onlys\OneDrive\เอกสาร\MedicalOrdersPerShift_LpcXl1CaREiNNks8kI9-2g.xls` | `2026-03-23T10:08:58+07:00` |
| `MedicalOrdersPerShift_nlojoCmLWEetROaVvWSqbw.xls` | `C:\Users\onlys\OneDrive\เอกสาร\MedicalOrdersPerShift_nlojoCmLWEetROaVvWSqbw.xls` | `2026-03-23T10:08:59+07:00` |
| `MedicalOrdersPerShift_tezFf7r1FUOO5bHgQ4spCA.xls` | `C:\Users\onlys\OneDrive\เอกสาร\MedicalOrdersPerShift_tezFf7r1FUOO5bHgQ4spCA.xls` | `2026-03-27T14:18:30+07:00` |
| `MedicalOrdersPerShift_w_tBVXbcAUqWtkmuwrUnLQ.xls` | `C:\Users\onlys\OneDrive\เอกสาร\MedicalOrdersPerShift_w_tBVXbcAUqWtkmuwrUnLQ.xls` | `2026-03-27T14:18:28+07:00` |
| `MedicalOrdersPerShift_XVXWM_WY9E_JiUriNP7ZQQ.xls` | `C:\Users\onlys\OneDrive\เอกสาร\MedicalOrdersPerShift_XVXWM_WY9E_JiUriNP7ZQQ.xls` | `2026-03-27T14:18:07+07:00` |
| `medinterface.xlsx` | `C:\Users\onlys\OneDrive\เอกสาร\medinterface.xlsx` | `2026-05-20T15:55:34+07:00` |
| `medusertype.xls` | `C:\Users\onlys\OneDrive\เอกสาร\medusertype.xls` | `2026-05-25T08:39:20+07:00` |
| `meduseunit.xls` | `C:\Users\onlys\OneDrive\เอกสาร\meduseunit.xls` | `2026-05-25T08:39:18+07:00` |
| `Porjai_Abstract_HIS_API_v3.pdf` | `C:\Users\onlys\Downloads\Porjai_Abstract_HIS_API_v3.pdf` | `2026-04-01T18:35:34+07:00` |
| `Porjai_Abstract_HIS_API_v4.docx` | `C:\Users\onlys\Flora\docs\Porjai_Abstract_HIS_API_v4.docx` | `2026-05-26T19:24:29+07:00` |
| `Porjai_Abstract_HIS_API_v4.pdf` | `C:\Users\onlys\Downloads\Porjai_Abstract_HIS_API_v4.pdf` | `2026-05-20T16:23:08+07:00` |
| `Porjai_Abstract_HIS_API_v4_0.pdf` | `C:\Users\onlys\Downloads\Porjai_Abstract_HIS_API_v4_0.pdf` | `2026-05-20T16:33:39+07:00` |
| `Porjai_Abstract_HIS_API_v4_1.pdf` | `C:\Users\onlys\Downloads\Porjai_Abstract_HIS_API_v4_1.pdf`<br>`C:\Users\onlys\OneDrive\Desktop\KCMH\Porjai_Abstract_HIS_API_v4.pdf` | `2026-05-20T16:29:40+07:00`<br>`2026-05-20T16:30:28+07:00` |
| `Porjai_Abstract_HIS_API_v4_abs.docx` | `C:\Users\onlys\OneDrive\เอกสาร\Porjai_Abstract_HIS_API_v4_abs.docx` | `2026-05-20T15:59:02+07:00` |
| `Porjai_Abstract_HIS_API_v4_abs.md` | `C:\Users\onlys\OneDrive\เอกสาร\Porjai_Abstract_HIS_API_v4_abs.md` | `2026-05-20T15:59:02+07:00` |
| `Porjai_Abstract_HIS_API_v4_abs.pdf` | `C:\Users\onlys\OneDrive\เอกสาร\Porjai_Abstract_HIS_API_v4_abs.pdf` | `2026-05-20T15:59:18+07:00` |
| `Porjai_Abstract_HIS_API_v5.pdf` | `C:\Users\onlys\Flora\docs\Porjai_Abstract_HIS_API_v5.pdf` | `2026-05-27T16:19:34+07:00` |
| `Porjai_Abstract_HIS_API_v5_draft.docx` | `C:\Users\onlys\Flora\docs\Porjai_Abstract_HIS_API_v5_draft.docx` | `2026-05-28T12:14:23+07:00` |
| `Porjai_Abstract_HIS_API_v5_draft.md` | `C:\Users\onlys\Flora\docs\Porjai_Abstract_HIS_API_v5_draft.md` | `2026-05-27T14:19:17+07:00` |
| `Porjai_Abstract_HIS_API_v5_draft.pdf` | `C:\Users\onlys\Flora\docs\Porjai_Abstract_HIS_API_v5_draft.pdf` | `2026-05-27T09:09:03+07:00` |
| `Porjai_Abstract_HIS_API_v5_rev1.pdf` | `C:\Users\onlys\Flora\docs\Porjai_Abstract_HIS_API_v5_rev1.pdf` | `2026-05-28T12:14:49+07:00` |
| `Porjai_HIS_API.docx` | `C:\Users\onlys\Downloads\Porjai_HIS_API.docx` | `2026-03-25T12:44:22+07:00` |
| `Porjai_HIS_API_Spec.docx` | `C:\Users\onlys\Downloads\Porjai_HIS_API_Spec.docx` | `2026-03-25T12:43:42+07:00` |
| `Porjai_HIS_API_v2.docx` | `C:\Users\onlys\Downloads\Porjai_HIS_API_v2.docx` | `2026-03-26T10:08:41+07:00` |
| `porjai_tss_his_mapping.xlsx` | `C:\Users\onlys\Downloads\porjai_tss_his_mapping.xlsx` | `2026-03-21T22:39:54+07:00` |
| `porjai_v3.pdf` | `C:\Users\onlys\Flora\tmp_porjai_review\porjai_v3.pdf`<br>`C:\Users\onlys\OneDrive\เอกสาร\Porjai_Abstract_HIS_API_v3 - abs.pdf` | `2026-04-08T10:52:52+07:00` |
| `Porjai-AbstractHIS API Specification.pdf` | `C:\Users\onlys\OneDrive\เอกสาร\Porjai-AbstractHIS API Specification.pdf` | `2026-03-06T10:14:52+07:00` |
| `เส้นส่ง med interface พอใจ_ABS.xlsx` | `C:\Users\onlys\OneDrive\เอกสาร\เส้นส่ง med interface พอใจ_ABS.xlsx` | `2026-03-26T09:28:22+07:00` |
| `แบบตรวจรับงาน_HIS_TDMS_สถาบันโรคไต.xlsx` | `C:\Users\onlys\Hidro\แบบตรวจรับงาน_HIS_TDMS_สถาบันโรคไต.xlsx`<br>`C:\Users\onlys\OneDrive\เอกสาร\แบบตรวจรับงาน_HIS_TDMS_สถาบันโรคไต.xlsx` | `2026-07-03T14:11:35+07:00` |
| `สถาบันโรคไต_TDMS-HIS_Porjai-UAT.xlsx` | `C:\Users\onlys\Downloads\สถาบันโรคไต_TDMS-HIS_Porjai-UAT.xlsx` | `2026-07-03T14:39:36+07:00` |

The latest working contract family is v5, but it remains a draft pending HIS
confirmation. Historical versions are retained to preserve decision history.
