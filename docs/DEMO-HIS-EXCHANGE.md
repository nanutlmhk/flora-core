# Demo HIS exchange patients

Flora Leaf includes three fictional patients for an interoperability demonstration. They use the normal **Find in HIS** lookup and PostgreSQL buffer, while preserving enough provenance to explain how the patient was exchanged.

| Demo HN | Exchange | Clinical meaning |
|---|---|---|
| `D-HL7-001` | HL7 v2.5 `ADT^A01` | Event-driven hospital admission |
| `D-FHIR-001` | FHIR R4 `Patient` + `Encounter` | Resource-based REST exchange |
| `D-MPI-001` | IHE PDQm | Enterprise patient demographic/MPI query |

Each result identifies itself as synthetic and shows its protocol, event/resource, source system, and demo message/resource identifier. The fixtures contain demographics, encounter identifiers, observations, allergies, and laboratory results so the preparation workflow can be demonstrated beyond patient-name lookup.

The **Code** action shows a representative wire payload: pipe-delimited HL7 ER7 for the ADT feed and formatted FHIR JSON Bundles for FHIR R4 and PDQm. Imported encounter facts (class, service, priority, location and attending clinician) are shown separately from Flora's clinician-entered perioperative plan (procedure, diagnosis, anaesthesia technique, ASA status and surgical priority).

Set `FLORA_HIS_DEMO_MODE=true` to expose the demo choices. Set it to `false` at a real site; HNs not in the demo catalog always continue to the configured `HIS_GATEWAY_BASE_URL`.
