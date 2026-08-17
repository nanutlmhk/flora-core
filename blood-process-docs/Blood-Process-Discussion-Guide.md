# AIDAS Blood Process: Discussion Guide for Hospital IT & Clinical Staff

This document provides a unified workflow for managing blood transfusions within AIDAS, integrated with the hospital HIS/Blood Bank system.

## 1. Unified Workflow Diagram

```mermaid
flowchart TD
    %% Define Styles
    classDef his fill:#f9f,stroke:#333,stroke-width:2px;
    classDef clinical fill:#bbf,stroke:#333,stroke-width:2px;
    classDef aidas fill:#bfb,stroke:#333,stroke-width:2px;
    classDef decision fill:#fff,stroke:#333,stroke-width:2px,stroke-dasharray: 5 5;

    subgraph HIS [HIS / Blood Bank (Data Source)]
        direction TB
        H1[Prepare Blood Bags for Patient<br/><i>(HN / AN)</i>]
        H2[Dispense Bags / Mark as Ready]
        H3[Available in HIS Database]
        H4[Add new bags if requested]
    end

    subgraph CLINICAL [Clinical Workflow (Bedside/OR)]
        direction TB
        C1([Start Anesthesia Case])
        C2[Open Blood Board in AIDAS]
        C3[Receive physical bag in OR]
        C4[Verify Bag vs Patient Identity<br/><i>(Manual Cross-check)</i>]
        C5{Need Warming?}
        C6[Warm Bag]
        C7[Start Transfusion]
        C8{Monitor Status}
        C9[Complete Transfusion]
        C10[Stop Early / Manage Reaction]
        C11([End Case & Review Report])
    end

    subgraph AIDAS [AIDAS (Recording & Tracking)]
        direction TB
        A1[Fetch Bag List from HIS]
        A2[Display Case Blood Board<br/><i>(Sync with HIS)</i>]
        A3[Mark Bag as 'Received in OR']
        A4[Scan/Select Bag & Record Checker]
        A5[Track 'Warming' Status]
        A6[Record Start Time & Initial Amount]
        A7[Record End Time & Final Amount]
        A8[Refresh HIS List<br/><i>(Append new, keep local history)</i>]
        A9[Generate Final Blood Summary]
    end

    %% Workflow Connections
    C1 --> C2
    C2 --> A1
    A1 --> H3
    H3 --> A2
    A2 --> C3
    C3 --> A3
    A3 --> C4
    C4 --> A4
    A4 --> C5
    
    C5 -- Yes --> C6
    C6 --> A5
    C5 -- No --> A6
    A5 --> A6
    
    A6 --> C7
    C7 --> C8
    
    C8 -- Standard --> C9
    C8 -- Issue --> C10
    
    C9 --> A7
    C10 --> A7
    
    A7 --> H4
    H4 -- If more blood needed --> A8
    A8 --> A2
    
    A7 --> C11
    C11 --> A9

    %% Assign Classes
    class H1,H2,H3,H4 his;
    class C1,C2,C3,C4,C6,C7,C9,C10,C11 clinical;
    class A1,A2,A3,A4,A5,A6,A7,A8,A9 aidas;
    class C5,C8 decision;
```

## 2. Key Discussion Points for Doctors (Clinical)

- **Safety First:** AIDAS does not replace bedside checking. It records that the check occurred and by whom.
- **Workflow-Centric:** The app follows the real-world lifecycle: Received -> Checked -> Warming -> Transfusing -> Completed.
- **Flexibility:** Supports multiple bags per case. Handles "extra" bags requested mid-surgery seamlessly.
- **Exceptions:** Provides quick ways to record early stops or adverse reactions directly in the digital record.

## 3. Key Discussion Points for Hospital IT (Technical)

- **Source of Truth:** HIS remains the official source for blood bank data (Bag ID, Component, Blood Group).
- **List-Based Integration:** Instead of one-by-one lookups, AIDAS fetches a case-level list (by HN/AN) to reduce API calls and improve performance.
- **State Separation:** HIS tracks "Bank Status" (Ready/Dispensed), while AIDAS tracks "Intraoperative Status" (Warming/Transfusing).
- **Non-Destructive Sync:** Refreshing the HIS list appends new bags without overwriting local AIDAS timestamps or status updates.

## 4. Why This Approach?

Current systems often force users into a "one-bag-at-a-time" wizard which doesn't match the reality of high-volume surgery (e.g., Cardiac or Trauma). This unified model allows AIDAS to act as a **Case Blood Board**, providing a high-level overview of all blood products used during the anesthesia period.
