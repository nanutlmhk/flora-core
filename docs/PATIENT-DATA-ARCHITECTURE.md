# FLORA Patient Data Architecture

## Purpose

The Patient workspace is the clinician's entry point to the longitudinal patient record, but `Patient` must not become one giant database row. FLORA presents related information together while preserving the ownership, time context, provenance, and lifecycle of each clinical fact.

The design follows three sources:

1. the fields present in the local Innovian archive schema;
2. data available from the hospital HIS and FLORA case workflow;
3. the resource boundaries in HL7 FHIR.

No patient values were read for this analysis. Only legacy database metadata (table and column names) was inspected.

## The core rule

| Question | Owner | Examples |
| --- | --- | --- |
| Who is this person? | Patient master | HN/MRN, national ID, names, birth date, sex, nationality, language, address, telecom, next of kin |
| Why and where are they receiving care now? | Encounter / case | AN, admission, service, OR/ICU, room/bed, care team, admission/discharge, encounter diagnosis |
| What is clinically true or observed? | Clinical resources | allergies, problems, vitals, height/weight, blood group, labs, procedures, medications, devices, documents |

This separation prevents case data from overwriting the enterprise patient identity and prevents a newly synced HIS value from changing the historical snapshot of a signed or archived case.

## Patient workspace information architecture

### 1. Profile

- identifiers: HN/MRN, national ID, passport, other facility identifiers and identifier type;
- Thai and English names, title, aliases and previous names;
- administrative sex, birth date, deceased status when applicable, and multiple-birth indicator;
- nationality, race, ethnicity, religion and marital status where locally required;
- preferred language and interpreter requirement;
- photo only when hospital policy permits it;
- identity verification state, source system, last synchronization time and duplicate/linked identity status.

FHIR owner: `Patient`, with jurisdiction-specific extensions where the core resource does not define the concept.

### 2. Contact

- mobile, home/work phone and email;
- current, registered and temporary addresses with validity periods;
- preferred contact channel;
- emergency contacts, guardian and next of kin, including relationship, priority and instructions;
- nominated primary care provider and managing organization.

FHIR owner: `Patient.telecom`, `Patient.address`, `Patient.contact`, `RelatedPerson`, `Patient.generalPractitioner`, and `Patient.managingOrganization`.

### 3. Encounter

- AN/visit identifiers and pre-admission identifier;
- planned and actual admission, transfer and discharge times;
- patient class and status, service, specialty, ward, room, bed and movement history;
- admission source, priority, reason, encounter diagnoses and discharge disposition;
- attending clinician, care team and responsible organization;
- diet, isolation, interpreter, mobility and other special arrangements;
- payer, coverage and account references.

FHIR owner: `Encounter`, `EncounterHistory`, `Location`, `CareTeam`, `Coverage`, and `Account`.

### 4. Safety and clinical summary

- allergies and intolerances, including verification, severity, manifestations and absence assertions;
- active problems and diagnoses, past medical and surgical history;
- advance directives, consent, resuscitation status and other alerts;
- infection/isolation risk, pregnancy status and relevant social history;
- implanted or patient-used devices;
- family history and risk assessments.

FHIR owner: `AllergyIntolerance`, `Condition`, `Procedure`, `Consent`, `DocumentReference`, `Observation`, `DeviceUsage`, `FamilyMemberHistory`, and `RiskAssessment`.

### 5. Measurements and diagnostics

- vital signs and device measurements;
- height, weight, BMI, blood group and other point-in-time assertions;
- laboratory results, panels, specimens, pathology, imaging and genomic reports;
- clinical scores and assessments;
- result status, reference range, abnormal/critical flag, performer and provenance.

FHIR owner: `Observation`, `DiagnosticReport`, `Specimen`, `ImagingStudy`, `ServiceRequest`, and `QuestionnaireResponse`.

### 6. Medication and therapy

- current and historical medication list;
- medication orders, dispensing and actual administrations;
- FLORA bolus and infusion administrations with dose, rate, route, time and performer;
- immunizations, nutrition orders and care plans.

FHIR owner: `MedicationStatement`, `MedicationRequest`, `MedicationDispense`, `MedicationAdministration`, `Immunization`, `NutritionOrder`, and `CarePlan`.

### 7. Documents and provenance

- clinical notes, uploaded files, scanned external reports and generated case reports;
- author, source system, entered/updated timestamps, version and verification state;
- consent/security labels and a complete audit history;
- reconciliation status when HIS, device, manual entry and imported documents disagree.

FHIR owner: `DocumentReference`, `Composition`, `Provenance`, `AuditEvent`, and `Consent`.

## What Innovian confirms

The local `prodbarchive` metadata contains these relevant areas:

| Innovian source | Representative coverage | FLORA destination |
| --- | --- | --- |
| `t_Patientinfo` | patient ID, names, admission/discharge, bed/care unit, device/monitor state | Patient identity + Encounter + Device association |
| `t_PatientDemog` | address, DOB, gender, race, religion, blood type, weight/height, government ID, marital status, nationality, language, ASA, specialty and ward | Patient + Observation + Encounter |
| `t_FamilyContactinfo` | names, relationship, phones, email, address, priority and instructions | Patient contact / RelatedPerson |
| `t_AdmissionData` | payment source, admission times, advance directives, resuscitation status, origin, condition, service and physician | Encounter + Coverage + Consent/clinical alert |
| `t_MedicalHistory` | pre-existing disease, admission diagnoses/reasons, procedures and notes | Condition + Procedure + clinical history |
| `t_allergies`, `t_standAloneAllergies` | allergen, category, severity, reaction, certainty and comments | AllergyIntolerance |
| `t_LabPatient`, `t_LabResult`, `t_LabOrder` | demographics copied into lab context, active medication, diet, isolation, orders and results | ServiceRequest + Observation + DiagnosticReport |
| `t_PatientPhysicians` | clinicians, roles and contact details | Practitioner / PractitionerRole / CareTeam |
| `t_insuranceinfo` | payer and insurance details | Coverage + Account |

Innovian sometimes duplicates patient demographics inside clinical or laboratory tables. FLORA should ingest that data with provenance, then reconcile it into the correct canonical resource instead of copying the legacy duplication pattern.

## Persistence and lifecycle

FLORA should maintain three deliberate layers:

1. **Enterprise patient master** — the latest verified identity and contact record keyed by durable identifiers.
2. **Encounter record** — admission and location data that changes during a visit.
3. **Case snapshot** — the exact patient and encounter context used by a FLORA OR/ICU case. It remains editable after discharge and becomes immutable after archive/sign-off.

Every imported or edited field needs source, author, recorded time, last update, verification state and an audit trail. A HIS refresh must never silently erase a clinician correction; conflicting values should be surfaced for reconciliation.

## Current delivery boundary

The Patient UI now exposes profile, contact/addresses/next-of-kin, allergies and laboratory results. Existing HIS-backed demographic and contact columns are persisted into `case_his_patient`; additional workflow fields remain in the case draft until their canonical tables are introduced.

The next backend slice should introduce durable Patient/Encounter identifiers and resource-oriented tables or documents for conditions, procedures, observations, medication history, coverage, consent, care team and document references. Do not add those domains as more columns on `case_his_patient`.

## Standards references

- HL7 FHIR Patient: https://hl7.org/fhir/R5/patient.html
- HL7 FHIR Encounter: https://hl7.org/fhir/R5/encounter.html
- HL7 FHIR Clinical module: https://hl7.org/fhir/R5/clinicalsummary-module.html
- HL7 FHIR Diagnostics module: https://hl7.org/fhir/R5/diagnostics-module.html
- HL7 FHIR Medications module: https://hl7.org/fhir/R5/medications-module.html
