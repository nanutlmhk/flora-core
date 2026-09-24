# FLORA device compatibility catalog

Status: working evidence register; not yet a public compatibility claim.

FLORA counts exact device models or explicitly versioned gateway products, not
protocol names. A protocol implementation can make many devices candidates, but
each model remains a candidate until its transport, message profile, parameter
mapping, units, timestamps, patient/bed context, failure behavior, and supported
software versions have been verified.

## Public counting rules

1. Count an exact model once, even when it supports multiple transports.
2. Do not count a family name as multiple devices until its models are enumerated.
3. Do not count a protocol specification as a device.
4. HL7 capability qualifies a product for the gateway/profile candidate list; it
   does not prove compatibility with FLORA's current HL7 profile.
5. A shared driver may support multiple models, but every counted model needs its
   own evidence record and supported firmware/software scope.
6. Marketing totals include only `Validated` and, when clearly labelled,
   `Integration tested` entries. Candidate totals must be published separately.
7. Every entry must identify the connection route: direct serial, direct network,
   central station, vendor gateway, or third-party gateway.

Recommended public wording:

> FLORA currently supports **X validated device models**, with **Y additional
> integration-tested models** and **Z protocol/gateway candidates under
> validation**.

## Evidence levels

| Level | Meaning | May enter headline count? |
| --- | --- | --- |
| Validated | Tested with the named physical model in an approved environment, with mapped values reconciled against the device and acceptance evidence retained | Yes |
| Integration tested | Physical or vendor-approved integration test completed, but production/site acceptance remains pending | Yes, only when separately labelled |
| Implemented | Driver and mappings exist, but the named model still requires authorized physical-device validation | No |
| Gateway/profile candidate | Device or central system advertises a relevant HL7/vendor interface, but FLORA has not validated its exact message profile | No |
| Research/replay | Parser or replay evidence exists without a validated live transport | No |
| Protocol candidate | Vendor documentation identifies a compatible transport/protocol; FLORA model validation has not started | No |
| Planned | Product scope only; no support claim | No |

## Current repository evidence

| Manufacturer | Device/model | Category | Route | Current evidence | Status |
| --- | --- | --- | --- | --- | --- |
| GE HealthCare | Carestation 750 | Anesthesia workstation | Direct RS232, Datex-Ohmeda-style serial path | Repository driver plus documented real integration/test evidence | Validated candidate for evidence-package review |
| GE HealthCare | Aisys CS2 | Anesthesia workstation | Direct RS232 using the GE750/S/5-related path | Driver exists; current handover notes require real-room verification | Implemented |
| GE HealthCare | CARESCAPE B650 | Patient monitor | Direct serial, S/5 DRI-related path | Driver and hardware troubleshooting evidence exist; model/firmware/site scope must be consolidated | Integration-tested candidate pending evidence review |
| GE HealthCare | CARESCAPE B850 | Patient monitor | Direct serial, S/5 DRI-related path | Release notes describe completed workflow support; validation record must be consolidated | Integration-tested candidate pending evidence review |
| GE HealthCare | B105 | Patient monitor | HL7 v2.x over TCP/MLLP | Named in the existing HL7 listener, without a model-specific acceptance record | Gateway/profile candidate |
| GE HealthCare | B125 | Patient monitor | HL7 v2.x over TCP/MLLP | Named in the existing HL7 listener, without a model-specific acceptance record | Gateway/profile candidate |
| GE HealthCare | B450 | Patient monitor | HL7 v2.x over TCP/MLLP or family-specific path | Named in the existing listener; exact deployed route and profile require verification | Gateway/profile candidate |
| Dräger | Infinity M540 / IACS | Patient monitor/system | UDP multicast | Numeric parser and synthetic replay exist; live multicast remains disabled and unvalidated | Research/replay |
| Dräger | Vista 120 | Patient monitor | Vista CMS / Vista 120 Gateway, HL7 v2.x | Vendor documents gateway-based HL7; site profile and FLORA mapping require validation | Gateway/profile candidate |
| Dräger | Vista 120 S | Patient monitor | Vista CMS / Vista 120 Gateway, HL7 v2.x | Vendor documents the Vista family/CMS path; site profile requires validation | Gateway/profile candidate |
| Dräger | Vista 120 SC | Patient monitor | Vista CMS / Vista 120 Gateway, HL7 v2.x | Vendor documents the Vista family/CMS path; site profile requires validation | Gateway/profile candidate |
| B. Braun | Space system through BCC/SpaceCom | Infusion system | Vendor TCP/LAN integration | Service, parser, status, and reconnect path exist; authorized deployment validation remains required | Implemented |
| Philips | IntelliVue MX/MP family through PIIC iX / IntelliBridge | Patient monitor ecosystem | Central system/gateway HL7 | Repository names the family; exact models and exported HL7 profile are not yet validated | Gateway/profile candidate |
| Fresenius Kabi | Agilia family | Infusion system | Device-specific integration | Archived artifact exists, while handover material describes Fresenius expansion as planned | Planned |

No numeric headline should be calculated from this table until the pending evidence
packages are reviewed. The status text intentionally distinguishes code presence
from verified compatibility.

## MEDIBUS.X protocol candidates

Dräger's MEDIBUS.X profile documentation identifies multiple product families.
The repository currently contains protocol research material, not a production
MEDIBUS.X runtime adapter. The following list is therefore an opportunity backlog,
not a compatibility claim:

| Product/model named by available evidence | Candidate route | Status |
| --- | --- | --- |
| Atlan A300 | RS232 MEDIBUS.X | Protocol candidate |
| Atlan A300 XL | RS232 MEDIBUS.X | Protocol candidate |
| Atlan A350 | RS232 MEDIBUS.X | Protocol candidate |
| Atlan A350 XL | RS232 MEDIBUS.X | Protocol candidate |
| Perseus A500 | RS232 MEDIBUS.X | Protocol candidate |
| Primus | MEDIBUS / MEDIBUS.X, version-dependent | Protocol candidate |
| Primus IE | MEDIBUS / MEDIBUS.X, version-dependent | Protocol candidate |
| Zeus IE | MEDIBUS.X, version-dependent | Protocol candidate |
| Fabius family | MEDIBUS.X, exact model/version to enumerate | Protocol candidate |
| Evita V300 | MEDIBUS.X, version-dependent | Protocol candidate |
| Evita V500 | MEDIBUS.X, version-dependent | Protocol candidate |
| Babylog VN500 | MEDIBUS.X, version-dependent | Protocol candidate |
| Savina 300 | MEDIBUS.X, version-dependent | Protocol candidate |
| Isolette 8000 plus | MEDIBUS.X, version-dependent | Protocol candidate |

Before promotion, obtain the applicable device instructions, protocol/profile
edition, cable and isolation specification, device software version, authorized
capture, parameter reconciliation, alarm/message behavior, and disconnect/recovery
test.

## HL7 gateway/profile candidates

An HL7 label is an invitation to run a profile qualification, not automatic
compatibility. For every product or gateway, record:

- exact product, software and gateway version;
- direct-device versus CMS/gateway route;
- HL7 version and message types;
- TCP/MLLP or TLS transport and ACK behavior;
- sending frequency, store-and-forward behavior and clock source;
- patient, visit, bed and device identifiers;
- OBX codes, units, status fields, abnormal flags and null semantics;
- waveform/document support, if any;
- required license and vendor configuration;
- disconnect, duplicate, replay and malformed-message behavior.

Initial candidates include:

| Ecosystem/model | Expected route | Status |
| --- | --- | --- |
| Dräger Vista 120 / 120 S / 120 SC | Vista CMS and Vista 120 Gateway HL7 output | Gateway/profile candidate |
| Philips IntelliVue MX400 / MX450 / MX500 / MX550 / MX700 / MX750 / MX800 / MX850 | PIIC iX or IntelliBridge HL7 stream, depending configuration | Gateway/profile candidate |
| Philips IntelliVue MP2 / MP5 / MP20 / MP30 / MP40 / MP50 / MP60 / MP70 / MP80 / MP90 | PIIC iX or IntelliBridge HL7 stream, depending configuration | Gateway/profile candidate |
| Philips IntelliVue X2 / X3 / MX40 | Philips monitoring ecosystem and central/gateway route | Gateway/profile candidate |
| Philips Patient Monitor 6100 / 6300 / 6500 | Vendor-documented HL7 outbound or enterprise monitoring route | Gateway/profile candidate |
| Mindray BeneVision N12 / N15 / N17 | Vendor-documented direct HL7 connection to the hospital clinical network | Gateway/profile candidate; direct-device profile to validate |
| Mindray Accutorr 7 | Vendor-documented selectable HL7 or eGateway data-send method | Gateway/profile candidate; direct-device profile to validate |
| Mindray BeneVision N22 / N19 / N17 / N15 / N12 / N1 and TM80 | BeneVision CMS and Mindray eGateway, IHE HL7 v2.6 / IHE PCD v2 | Gateway/profile candidate |
| Mindray BeneView T9 / T8 / T6 / T5 / T1 / TDS | Mindray eGateway, IHE HL7 v2.6 | Gateway/profile candidate |
| Mindray ePM 15 / 12 / 10 / 12M / 10M | Mindray eGateway, IHE HL7 v2.6; verify any model-specific direct mode separately | Gateway/profile candidate |
| Mindray iPM 12 / 10 / 8 and iMEC 15 / 12 / 10 / 8 and uMEC 12 / 10 | Mindray eGateway, IHE HL7 v2.6 | Gateway/profile candidate |
| Mindray PM 9000 / 8000 / 7000 and MEC 2000 / 1200 / 1000 | Mindray eGateway, IHE HL7 v2.6 | Gateway/profile candidate |
| Mindray VS 900 / 800, BeneHeart D6 / D3 and TMS-6016 | Mindray eGateway or central-station route; exact exported content varies | Gateway/profile candidate |

These models must not enter the supported-device headline merely because the vendor
mentions HL7. Promotion requires a FLORA profile package and validation evidence.

## Required evidence package per counted model

- manufacturer, exact model, hardware revision and software/firmware version;
- adapter version, mapping version and configuration checksum;
- authorized physical connection and wiring/network diagram;
- sanitized raw sample plus parser test fixture;
- parameter and unit reconciliation against the device display;
- timestamp, patient/bed association and update-frequency validation;
- silence, disconnect, corrupt-message, duplicate and recovery tests;
- hospital/site, test date, tester and clinical/BME acceptance owner;
- limitations, excluded parameters and revalidation trigger.

## Reference sources

- [Picis Clinical Information System Suite](https://www.picis.com/solution/clinical-information-system-suite/) — competitor wording describing more than 400 connected devices.
- [Dräger MEDIBUS.X Profile Definition](https://www.draeger.com/Content/Documents/TDoc/MEDIBUS.X_ProfileDefinition_9052608_edition22_202403.pdf) — protocol profile and named product-family evidence.
- [Dräger Vista 120 Gateway](https://www.draeger.com/en_uk/Products/Vista-120-Gateway) — HL7 vital-sign and ADT gateway capability.
- [Philips IntelliVue configuration guide](https://www.documents.philips.com/doclib/enc/fetch/2000/4504/577242/577243/577247/582636/582882/MX800%2C_Cableless%2C_IntelliVue_Patient_Monitors_Rel._H.0_Configuration_Guide_4535_642_29201_%28ENG%29.pdf) — enumerated MX/MP/X2 models for the specified release.
- [Mindray BeneVision N12/N15/N17](https://www.mindray.com/uk/products/patient-monitoring/continuous-patient-monitoring/benevision-n17-n15-n12) — vendor statement for direct HL7 connectivity.
- [Mindray Accutorr 7 operator manual](https://www.mindray.com/content/dam/xpace/en_us/resource-library/patient-monitoring/technical-document/vital-signs-monitors/Accutorr%207-ops-manual-18.0.pdf) — selectable direct HL7 or eGateway output.
- [Mindray eGateway brochure](https://www.mindray.com/content/dam/xpace/de/resources/klinische-it/01_eGateway-Brochure_ENG_20190131_S.pdf) — named monitor families and IHE HL7 v2.6 gateway output.
