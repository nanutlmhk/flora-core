# KCMH Application Inventory

This document supports `T1 Q1 - Application Inventory`.

Porjai currently maintains or supports the following applications/components in this scope:

1. `Aidas`
   - An anesthesia information application developed closely with anesthesiologists and designed around real perioperative workflow pain points.
   - It is used for perioperative documentation, case recording, charting, and report generation.
   - The system architecture supports both standalone mode and network mode depending on deployment context.

2. `Hidro`
   - A medical device connectivity and middleware application used to collect data from bedside devices and provide that data to downstream systems such as AIDAS.
   - In addition to device integration, it can also act as a middleware layer for hospital API integration such as `getHIS`.

3. `Innovian`
   - A legacy anesthesia information management system (AIMS) currently under maintenance/support scope.

4. `Infinity Gateway`
   - A gateway/integration component used in the existing environment for medical device or monitoring data connectivity.

5. `Xnet Datacaptor Gateway`
   - A gateway/integration component used to capture and/or relay device data into downstream systems.
