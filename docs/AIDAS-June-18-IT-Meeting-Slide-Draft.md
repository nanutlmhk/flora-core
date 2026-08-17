# AIDAS June 18 IT Meeting Slide Draft

This draft is for the June 18 hospital IT meeting.

Goal:

- focus on current deployment and support needs
- avoid re-explaining basic AIDAS background too much
- show what is already working
- show what is unstable
- ask clearly for the exact support needed from hospital IT

---

## Slide 1. Title

Suggested title:

`AIDAS Deployment Update and IT Support Discussion`

Suggested subtitle:

`King Chulalongkorn Memorial Hospital | June 18, 2026`

Talk track:

- today we will focus on deployment status, current test result, architecture, and IT support needed for next step

---

## Slide 2. Meeting Objective

Suggested title:

`Purpose of Today’s Meeting`

Suggested points:

- update current AIDAS and Hidro status in real OR use
- review current standalone deployment architecture
- review next-step client-server architecture
- summarize issues found during test in OR 508 and OR 701
- request support from hospital IT for network, server access, and printing

Talk track:

- this meeting is not to introduce the AIDAS idea from the beginning again
- this meeting is to align operational support for real deployment

---

## Slide 3. Current Innovian Maintenance Situation

Suggested title:

`Current Innovian Maintenance Situation`

Suggested points:

- Innovian is still the current reference environment in the hospital
- daily workflow and maintenance constraints remain important during transition
- existing device and workstation environment may still contain old integration settings
- this can affect troubleshooting when AIDAS/Hidro is tested on the same client PCs

Talk track:

- we are not discussing Innovian as a competitor here
- we need to understand the current environment because leftover configuration may affect AIDAS/Hidro stability

---

## Slide 4. AIDAS Standalone Architecture

Suggested title:

`AIDAS Standalone Architecture`

Suggested points:

- AIDAS runs locally on the OR workstation
- Hidro runs locally to receive device data
- local database stores the active case
- report is generated locally from case data
- HIS access is through hospital network when available

Suggested message:

- local-first design allows case documentation to continue even if central network service is not always available

Talk track:

- this is the current practical deployment model in the OR
- it reduces dependency on a central system during the active case

---

## Slide 5. Real Case Test Status

Suggested title:

`Current Real Case Test Status`

Suggested points:

- AIDAS and Hidro are already being tested in real OR use
- current focus rooms: `OR 508` and `OR 701`
- real case workflow has already provided useful feedback for forms, report output, patient page, and integration behavior
- this is no longer lab-only testing

Talk track:

- we are now in real workflow validation, not only technical simulation
- this is why deployment stability and support path matter more now

---

## Slide 6. OR 508 Result

Suggested title:

`OR 508: Current Result`

Suggested points:

- overall test result is acceptable
- AIDAS and Hidro can run and retrieve device data
- workflow feedback from users has already been incorporated into recent patches
- this room currently represents the stronger reference site

Talk track:

- OR 508 shows that the deployment model is workable in real use
- it is a useful benchmark when we compare behavior in another room

---

## Slide 7. OR 701 Result

Suggested title:

`OR 701: Current Result and Problem`

Suggested points:

- OR 701 still shows unstable Hidro status behavior
- in some situations data may still be transmitted while status appears offline
- after longer use the service may stop retrieving data completely
- this room may have environmental differences from past Innovian / Capsule / DataCaptor setup

Talk track:

- this is one of the key reasons we need IT coordination
- the problem may not be only in application logic but also in workstation environment

---

## Slide 8. What We Learned from 508 vs 701

Suggested title:

`Operational Lessons from OR 508 and OR 701`

Suggested points:

- same installer does not always mean same behavior in every room
- workstation history and device environment matter
- serial/USB environment may affect stability
- application logging and service diagnosis are now more important than before

Talk track:

- we need a more standardized deployment and support model
- room-by-room environmental differences must be reduced

---

## Slide 9. Hidro Service Architecture

Suggested title:

`Hidro Device Integration Architecture`

Suggested points:

- Hidro is the device integration layer
- Hidro checks configured device connections
- Hidro receives device data and stores/transfers observations
- AIDAS reads and documents the case
- service status and device data status should be separated clearly

Suggested status model:

- Patient Monitor
- Model
- COM Port
- Port Status: connected/disconnected
- Data Status: online/offline

Talk track:

- this separation helps users understand whether the problem is hardware connection or data flow

---

## Slide 10. AIDAS Client-Server Next Step

Suggested title:

`Next-Step AIDAS Client-Server Architecture`

Suggested points:

- local AIDAS in each OR remains the working unit
- central service/database can support delayed sync and remote view
- real-time waveform architecture is not required for the current goal
- 3 to 5 minute latency is acceptable for remote viewing use case

Talk track:

- this is a next-step architecture, not a replacement of the current local workflow
- local case safety still comes first

---

## Slide 11. Role of 10.35.202.6

Suggested title:

`Current Role of Server 10.35.202.6`

Suggested points:

- used as gateway/service point for HIS-related requests
- important for patient demographic retrieval and future hospital integration
- access control and service availability directly affect AIDAS workflow
- AIDAS needs stable access to this server from approved client IPs

Talk track:

- this server is already part of the practical integration path
- access and support around this machine need to be formalized

---

## Slide 12. HIS and Integration Direction

Suggested title:

`Current HIS Integration Direction`

Suggested points:

- current priority is stable patient information retrieval
- gateway/service layer is used to isolate hospital-side integration details from AIDAS clients
- future scope may include staff sync, allergy, labs, and blood bank workflow
- API behavior and access policy need close coordination with hospital IT and HIS team

Talk track:

- current direction is stepwise integration, not full big-bang integration
- we want to stabilize one useful path at a time

---

## Slide 13. IT Support Needed

Suggested title:

`Support Needed from Hospital IT`

Suggested points:

- stable network path between OR clients and `10.35.202.6`
- confirmed access/whitelist policy for AIDAS-related client IPs
- support for service hosting and restart ownership on the HIS gateway VM/server
- printer access for anesthesia report output
- support for workstation standardization in target rooms

Talk track:

- these are the practical items that will make deployment smoother
- most current blockers are operational, not conceptual

---

## Slide 14. Workstation Standardization Proposal

Suggested title:

`Workstation Standardization Proposal`

Suggested points:

- define a standard AIDAS/Hidro client image or checklist
- reduce leftover software/conflict from previous systems
- standardize serial/USB adapter model where possible
- standardize driver and startup behavior
- keep diagnostic logs available for support

Talk track:

- this is especially relevant because OR 508 and OR 701 behave differently under similar application versions

---

## Slide 15. Printing and Report Workflow

Suggested title:

`Report and Printer Support`

Suggested points:

- AIDAS generates anesthesia report locally
- printing must be easy and stable in bedside workflow
- printer access and policy should be confirmed for target rooms
- report output is a key user-facing deliverable, not a secondary feature

Talk track:

- if report output is difficult, user confidence drops immediately even if data capture works

---

## Slide 16. Immediate Next Actions

Suggested title:

`Immediate Next Actions After Meeting`

Suggested points:

- confirm target rooms for next deployment/support phase
- confirm IT owner/contact for server and network issues
- confirm access path to `10.35.202.6`
- confirm printer plan for report output
- agree on workstation cleanup/standardization approach where needed

Talk track:

- today should end with named owners and concrete next actions

---

## Slide 17. Closing

Suggested title:

`Expected Outcome`

Suggested points:

- stable and supportable AIDAS use in real OR workflow
- clear ownership between clinical team, Porjai, and hospital IT
- reduced deployment variability between rooms
- stronger path toward broader rollout and future client-server expansion

Talk track:

- the goal is not only to make the software run
- the goal is to make the deployment reliable enough that users trust it in daily care

---

## Optional Backup Slides

### Backup 1. AIDAS version timeline

- `1.0.0` first real clinical release
- `1.1.0` installer packaging
- `1.2.0` neuro OR expansion
- `1.2.1` stabilization
- `1.2.2` current deployment and patient-view/integration updates

### Backup 2. Known current technical issues

- Hidro status inconsistency in some rooms
- workstation environment differences
- gateway/HIS service stabilization
- printer/report workflow setup

### Backup 3. Future architecture direction

- remote view
- central database sync
- Hidro Box concept
- broader vendor integration
