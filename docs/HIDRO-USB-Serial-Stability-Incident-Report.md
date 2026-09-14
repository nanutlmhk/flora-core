# Hidro USB/Serial Stability Incident Report

## 1. Issue Title

`Hidro USB/Serial Connectivity Instability in Real OR Deployment`

## 2. Summary

During real operating room deployment, Hidro has shown unstable USB/serial communication behavior on some client workstations.

Observed behavior includes:

- device status randomly changes to offline
- data transmission may continue even while status appears offline
- in some cases unplug/replug of USB serial adapter restores operation
- in some cases full workstation restart is required
- in some rooms the service may eventually stop retrieving data after longer runtime

This issue is inconsistent across rooms and workstations, even when the same Hidro version is used.

## 3. Operational Impact

- reduced user confidence in Hidro and FLORA
- confusion between `status offline` and `actual data still flowing`
- interruption risk in real clinical workflow
- increased support burden during rollout
- difficulty scaling deployment room-by-room with confidence

## 4. Affected Context

Typical environment:

- Windows client workstation in OR
- USB-to-serial adapters
- serial-connected medical devices
- Hidro service running locally
- FLORA consuming data from Hidro local API

Known real deployment context includes rooms such as:

- `OR 508`
- `OR 701`

Behavior may differ between rooms.

## 5. Observed Symptoms

### Symptom Group A: Status inconsistency

- tray/UI may show device offline
- actual device data may still be entering Hidro database
- users cannot easily tell whether the problem is UI, transport, or real data flow failure

### Symptom Group B: Recovery inconsistency

- unplug/replug sometimes restores operation
- manual reconnect sometimes restores operation
- hard reset sometimes restores operation
- full Windows restart is sometimes required

### Symptom Group C: Long-running instability

- service may start normally
- device may connect normally
- after longer running time the data path may stop
- issue may reappear without clear single trigger

## 6. What Has Already Been Tried

The following mitigation attempts have already been tried and should be treated as known completed actions, not new suggestions.

### Software / Hidro-side attempts

- reconnect / retry logic
- improved serial recovery behavior
- diagnostics and logging
- status UX improvement
- separation of service reachability and device online state
- hard reset COM port workflow
- COM scanning / auto-detect logic
- selected COM port control
- transport/data diagnostics in tray and service

### Environment / workstation attempts

- clean / fresh Windows 11 installation
- disable USB power-saving options
- disable power saver behavior on USB ports
- retest on different rooms / different client machines

### Physical / support attempts

- unplug and replug USB adapter
- workstation restart
- repeated reconfiguration and retesting during real deployment support

## 7. Relevant Hidro Engineering History

The current codebase already includes multiple attempts to harden this area, including commits such as:

- serial recovery improvements
- diagnostics logging
- tray status reliability improvements
- hard reset COM port support
- auto-reconnect and retry controls

This means the issue should not be treated as a simple “missing reconnect logic” problem.

## 8. Timeline of Engineering Attempts

The instability problem should be viewed in the context of a clear sequence of engineering work, not as a single unresolved bug.

### Early foundation

- `2a190a7` Initial commit — Hidro extracted from flora-alpha
- `6ddfc8a` Add README with full project overview and API reference

### Visibility and diagnostics phase

- `d8f32b8` Add Diagnostics tab with live parameter feed per device
- `01e7da2` Reduce diagnostics refresh interval to 1 minute

### Device support and serial protocol expansion

- `7b3e77a` Add GE Bx50 and GE Aisys CS2 serial drivers (S/5 DRI protocol)
- `25e9a4c` Fix DRI levels and baud rate for CARESCAPE devices

### Recovery and status hardening

- `0e72f76` Improve Hidro serial recovery and simplify release packaging
- `3df9a1d` Improve Hidro status UX and recovery controls
- `cc085b7` Trust fresh device data in Hidro status UI

### Current diagnostics / reliability milestone

- `e327d59` Bump Hidro version to 1.2.1
- `dae0910` Hidro 1.2.2 diagnostics and status reliability

### Meaning of the timeline

This timeline shows that the team has already worked through:

- visibility improvements
- diagnostics improvements
- driver/protocol corrections
- serial recovery improvements
- status interpretation improvements

Therefore, the remaining issue should be treated as a deeper reliability problem, not as a lack of basic debugging effort.

## 9. Current Technical Interpretation

Based on repeated real-world behavior and the mitigation already attempted, the remaining issue is likely below the ordinary clinical application layer.

Most likely contributing layers:

1. Windows USB / serial driver instability
2. USB-to-serial adapter behavior or chipset inconsistency
3. workstation-specific environment residue or software conflict
4. COM handle / port rebind edge cases
5. long-running serial library or runtime edge cases under real deployment conditions

## 10. What This Issue Is Probably Not

This issue is probably not explained only by:

- ordinary frontend bug
- simple FLORA workflow problem
- one missing retry statement
- one missing reconnect button

## 11. Current Root-Cause Position

Current working position:

> We have already tried many reasonable application-level and workstation-level mitigations.  
> The remaining instability appears to be a deeper transport-layer or environment-layer problem rather than a simple bedside UI or documentation bug.

## 12. Recommended Next-Step Direction

The next-step strategy should focus on isolation, not repeated superficial workaround.

### Option A: Environment isolation

- standardize workstation image
- standardize adapter chipset/model
- verify whether legacy environment conflict still exists
- isolate affected room against known good room

### Option B: Connectivity middleware isolation

- create a dedicated middleware/service layer focused only on USB/serial connectivity reliability
- keep connection alive
- auto-recover transport safely
- expose stable downstream output to Hidro/FLORA
- avoid direct modification of FLORA clinical workflow layer

### Option C: Appliance / Hidro Box direction

- move serial/device connectivity out of general Windows client PC
- use dedicated single-board / embedded box for transport layer
- let workstation consume already-stabilized data path

## 13. Practical Recommendation

If external technical help is considered, the cleanest scope is:

- USB/serial transport reliability
- connectivity middleware
- appliance/bridge solution

The riskiest scope is:

- direct uncontrolled modification of FLORA/Hidro application core without clear ownership boundary

## 14. Information That Should Be Captured Going Forward

For each future incident, capture:

- room number
- workstation name / IP
- Windows image / install age
- USB adapter model / chipset / serial number if known
- device model
- configured COM port
- Hidro version
- whether status showed offline
- whether data actually continued
- whether unplug/replug fixed it
- whether hard reset fixed it
- whether workstation restart fixed it
- approximate runtime before failure
- diagnostics log reference

## 15. Bottom-Line Summary

This problem has already gone beyond basic app-level troubleshooting.

The evidence so far supports this conclusion:

- many normal software mitigations have already been implemented
- clean Windows and USB power adjustments have already been tried
- the issue still appears unpredictably in real deployment

Therefore, the next phase should focus on:

- transport-layer reliability
- environment standardization
- or architecture isolation such as a dedicated connectivity middleware / Hidro Box approach
