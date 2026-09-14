# Vimut Hidro Project Handoff

Last evidence review: 30 July 2026

Hospital: ViMUT Hospital

Product boundary: Dräger medical-device gateways, Hidro middleware, Porjai API
layer, hospital HIS, and support/monitoring workflow

## 1. Executive Summary

Vimut is a one-channel medical-device integration and maintenance engagement for
Vital Sign and Bedside Monitor data. The local evidence describes a migration
from an older middleware path toward Hidro, with Dräger gateways feeding a
hospital HIS integration path.

The strongest status evidence is:

- `Verified`: a Vimut purchase order dated 23 March 2026 exists for one annual
  maintenance item.
- `Verified`: the TOR defines a service period from 1 April 2026 through
  31 March 2027 and covers one integration channel.
- `Last documented, 30 May 2026`: the software had been installed, but hospital
  IT had not completed the configuration required to put the integration
  online. A joint Porjai/hospital IT meeting was still required.
- `Not evidenced`: no later go-live confirmation, signed technical acceptance,
  production health report, or resolved-network record was found in the local
  search.

The successor must therefore treat the system as `installed but live status
unverified`, not as confirmed production.

## 2. Contractual and Functional Scope

The Vimut TOR and maintenance attachments define the following scope:

- maintain one software integration channel for Vital Sign and Bedside Monitor
  data;
- receive data from designated Dräger medical devices/gateways;
- validate, map, transform, and handle errors in Hidro;
- use a Porjai API layer to submit the agreed data format to the hospital HIS;
- provide status monitoring, error logs, and fault notification;
- install in the hospital server environment and test with the selected devices
  and HIS;
- diagnose device-to-gateway, gateway-to-Hidro, and Hidro-to-HIS software-path
  failures;
- provide monthly onsite support and urgent remote support during the contract
  period;
- maintain minor compatibility changes when the agreed HIS or device interface
  changes within the maintenance scope.

Explicit exclusions in the maintenance material include:

- medical-device, server, storage, network, UPS, or other hardware repair or
  replacement;
- operating-system and third-party software licence costs;
- hospital VLAN, routing, firewall, LAN, VPN, and general network redesign;
- new channels, new device families, new external systems, or major features
  outside the agreed channel;
- major operating-system upgrades.

Commercial records do not perfectly agree. A January quotation describes a
three-year commitment and a different total from the March purchase order. The
successor must use the executed PO/contract and procurement confirmation as the
commercial authority; do not infer the active commercial terms from a draft
quotation.

## 3. Architecture

The local Vimut diagram contains these components:

- Dräger medical devices;
- Dräger Vista Gateway;
- Dräger Infinity Gateway;
- an ESXi server hosting gateway components;
- Hidro Server;
- BME PC client and BME laptop;
- MonkeyTech HIS;
- Porjai client access through VPN.

The diagram also contains private hospital network addresses. They are
intentionally omitted here. Obtain the current values from Vimut IT's approved
network source of truth and compare them with the original diagram.

Working logical path described by the TOR/maintenance scope:

```text
Dräger devices
  -> Dräger gateway layer (Vista / Infinity)
  -> Hidro integration service
  -> validation, mapping, transformation, retry/error handling
  -> Porjai API layer
  -> MonkeyTech HIS
```

The arrows in the historical architecture diagram should not be treated as a
complete protocol or routing specification. Confirm actual listener/client
direction, ports, message format, and ownership for every hop.

## 4. Component Responsibilities

### Dräger gateway layer

- Receives clinical/device data from designated Dräger devices.
- Exposes or forwards the agreed gateway output.
- Gateway software/licensing and device-level behavior may require Dräger or
  hospital biomedical support.

### Hidro

- Receives the configured gateway stream.
- Parses the agreed message format.
- Maps and transforms fields.
- Sends the agreed payload to HIS through the Porjai API layer.
- Records inbound, outbound, warning, and error evidence.
- Provides operational status and controlled service actions where implemented.

### Hospital HIS

- Owns the receiving endpoint and clinical-system acceptance behavior.
- Must confirm authentication, payload contract, response meanings, timeout,
  maintenance windows, and reconciliation process.

### Hospital IT/BME

- IT owns server/VM, approved network paths, VPN, firewall, routing, and HIS
  connectivity.
- BME owns device availability, device/gateway coordination, operational
  validation, and acceptance evidence.

### Porjai

- Owns the Hidro application/channel configuration, agreed mappings, logs,
  software support, and coordination across the device/gateway/HIS boundaries.

## 5. Last Documented Status and Open Work

| Item | Evidence status | Successor action |
| --- | --- | --- |
| Hidro installed | Last documented 30 May 2026 | Confirm host, installed version, service name, and current process state. |
| Hospital online configuration | Last documented incomplete | Ask Vimut IT for the closure record and test the approved route. |
| Joint project meeting | Last documented pending | Obtain minutes/actions from Porjai project owner or Vimut IT/BME. |
| Device data received by gateway | TBD with Vimut BME/Dräger owner | Capture timestamped gateway evidence. |
| Gateway data received by Hidro | TBD with Porjai support | Capture inbound counters/raw sample under PHI controls. |
| Hidro payload accepted by HIS | TBD with Vimut HIS owner | Run an approved end-to-end test and record response/reconciliation. |
| Monitoring and error logs | Planned by TOR; deployment not evidenced | Verify deployed functions and retention. |
| Notification | Planned by TOR; mechanism not evidenced | Confirm channel, recipients, severity, and escalation. |
| Signed technical acceptance | Not found | Obtain acceptance evidence from procurement/BME. |

## 6. Support and Incident Procedure

For any “no data” incident, preserve timestamps and check in this order:

1. Confirm the clinical device is producing data and is assigned to the expected
   gateway context.
2. Confirm the Dräger gateway service is running and has received recent data.
3. Confirm Hidro transport status and the timestamp of the last valid message.
4. Inspect parser/mapping errors separately from transport errors.
5. Confirm outbound request timestamp, destination, response status, and response
   body classification.
6. Ask the HIS owner to reconcile the same patient/event/time in HIS.
7. Record the responsible boundary: device, gateway, Hidro, network, API, HIS, or
   workflow.

Minimum incident evidence:

- incident start/end time in Asia/Bangkok;
- affected device/room/channel;
- last-known-good timestamp;
- gateway, Hidro inbound, Hidro outbound, and HIS response timestamps;
- software versions and service restart history;
- sanitized sample correlation identifier;
- owner, action, result, and recurrence status.

Do not restart a gateway, VM, or service until the hospital-approved authority
and evidence-capture procedure are known. A restart may destroy the most useful
diagnostic state.

## 7. Verification and Acceptance Test

The successor should produce a private, signed test record covering:

- correct device and patient context;
- gateway receives a valid message;
- Hidro receives and parses it;
- required fields map correctly;
- malformed or incomplete data is rejected visibly;
- HIS request reaches the approved endpoint;
- HIS success and failure responses are logged;
- retries occur only for approved transient failures;
- duplicate clinical messages are controlled;
- BME/HIS users can reconcile the result in the target system;
- monitoring shows service, transport, and data freshness separately;
- log access and retention comply with hospital policy;
- recovery after service restart is demonstrated.

## 8. Information the Successor Must Obtain from Owners

These facts were not safely recoverable from local documents and should be
obtained from the named source, not guessed:

- Vimut IT: current VM names, operating systems, private addresses, ports,
  firewall path, VPN method, certificates, backups, and restart authority.
- Vimut BME: active devices, models, rooms, gateway assignments, acceptance
  owner, and support priority.
- HIS/MonkeyTech owner: endpoint contract, authentication, expected responses,
  maintenance windows, reconciliation, and escalation.
- Porjai project owner: installed Hidro version, release artifact, configuration
  backup, change log, support roster, and latest meeting/actions.
- Procurement: executed contract/PO terms where draft quotations disagree.

### Mandatory VPN/security boundary

All Vimut VPN, credentials, MFA, certificates, private addresses, ports,
firewall, routing, allowlist, and remote-access information must be requested
directly from Vimut IT/security.

No security secret is supplied through this handoff. The outgoing developer
will provide security information only to authorized Vimut hospital IT
personnel. Vimut IT must validate the successor, approve access, provision the
account/profile, and communicate the permitted configuration through its own
secure channel.

## 9. Source Material

Copied-document folder:

`C:\Users\onlys\Flora\docs\handoff\Vimut Docs`

The folder is flat and contains documents only. Local timestamps use
Asia/Bangkok (`UTC+7`). The original sources remain in place.

| Document in `Vimut Docs` | Original source path | Local timestamp |
| --- | --- | --- |
| `ab.docx` | `C:\Users\onlys\Downloads\ab.docx` | `2026-01-13T10:15:00+07:00` |
| `fkpj-meeting-report-2026-05-30.md` | `C:\Users\onlys\Flora\fkpj-meeting-report-2026-05-30.md` | `2026-06-21T16:23:17+07:00` |
| `HANDOFF-HOSPITAL-CONTEXT.md` | `C:\Users\onlys\Flora\docs\HANDOFF-HOSPITAL-CONTEXT.md` | `2026-07-21T12:08:11+07:00` |
| `HANDOFF-RISKS-AND-OPEN-QUESTIONS.md` | `C:\Users\onlys\Flora\docs\HANDOFF-RISKS-AND-OPEN-QUESTIONS.md` | `2026-07-21T12:08:11+07:00` |
| `Medical-Device-Integration-Handover-Checklist-Response.md` | `C:\Users\onlys\Flora\docs\Medical-Device-Integration-Handover-Checklist-Response.md` | `2026-07-21T13:11:15+07:00` |
| `Medical-Device-Integration-Handover-Checklist-Response.pdf` | `C:\Users\onlys\Downloads\Medical-Device-Integration-Handover-Checklist-Response.pdf` | `2026-07-21T14:15:11+07:00` |
| `P3 TOR ย่อ_งานบำรุงรักษาเครื่องมือกลุ่ม Vital Sign แล.pdf` | `C:\Users\onlys\OneDrive\เอกสาร\P3 TOR ย่อ_งานบำรุงรักษาเครื่องมือกลุ่ม Vital Sign แล.pdf` | `2026-03-07T15:19:52+07:00` |
| `ViMUT Hospital-Purchase Order4110060127.pdf` | `C:\Users\onlys\Downloads\ViMUT Hospital-Purchase Order4110060127.pdf` | `2026-03-24T13:04:09+07:00` |
| `Vimut-Hidro-Diagram.pdf` | `C:\Users\onlys\Downloads\Vimut-Hidro-Diagram.pdf` | `2026-04-24T08:03:08+07:00` |
| `เอกสารแนบ.docx` | `C:\Users\onlys\Downloads\เอกสารแนบ.docx` | `2026-01-28T22:37:30+07:00` |
| `เอกสารแนบ.pdf` | `C:\Users\onlys\Downloads\เอกสารแนบ.pdf` | `2026-01-13T10:16:16+07:00` |
| `เอกสารแนบr01.docx` | `C:\Users\onlys\OneDrive\เอกสาร\เอกสารแนบr01.docx` | `2026-01-28T22:27:26+07:00` |
| `ใบเสนอราคา 3 ปี.pdf` | `C:\Users\onlys\OneDrive\เอกสาร\ใบเสนอราคา 3 ปี.pdf` | `2026-01-19T17:22:31+07:00` |
| `ใบเสนอราคา PHS-MA-69-01-002.pdf` | `C:\Users\onlys\OneDrive\เอกสาร\ใบเสนอราคา PHS-MA-69-01-002.pdf` | `2026-01-20T10:12:59+07:00` |
| `ใบเสนอราคา.pdf` | `C:\Users\onlys\Downloads\ใบเสนอราคา.pdf` | `2026-01-13T08:59:48+07:00` |

The strongest Vimut sources are the TOR, purchase order, maintenance-scope
attachments, architecture diagram, and the 30 May 2026 meeting report.
