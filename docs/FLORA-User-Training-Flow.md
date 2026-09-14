# FLORA User Training Flow

Prepared for official user training after live use in OR rooms `701`, `508`, and `901`.

This document is not yet the full user manual. Its purpose is to define the training structure, session flow, and learning priorities for real OR users.

---

## 1. Training objective

The training objective is to make users able to:

- start and continue a case safely in FLORA
- understand what comes from automatic device capture and what must still be entered manually
- document the main anesthesia workflow correctly
- recognize common problems early
- continue working safely when some data are missing
- generate and review the report before discharge / archive

The goal is not to teach every page in maximum detail on day 1.

The goal is to make real OR users confident enough to use FLORA correctly in daily work.

---

## 2. Target users

Training should be split by actual role, because not every user needs the same depth.

### 2.1 Core clinical users

- anesthesiologists
- anesthesia residents
- nurse anesthetists

These users need the full clinical workflow.

### 2.2 Support / operational users

- staff helping with case setup
- users who review report output
- local room super-users

These users need enough knowledge to support workflow, but not every advanced documentation detail.

### 2.3 Technical support users

- local IT support
- super-user assigned in the department

These users need startup, troubleshooting, Hidro/device status, and report/printer basics.

---

## 3. Training principles

Training should follow these principles:

- case-based, not menu-based
- start from the normal happy path first
- then teach exception handling
- separate bedside workflow from technical troubleshooting
- use real room workflow examples from `701`, `508`, and `901`
- keep each session short enough for OR staff attention and schedule reality

Users should leave training with a clear answer to:

- what do I do before case start?
- what do I do during the case?
- what do I do if data stop coming?
- what do I do before report / discharge / archive?

---

## 4. Recommended training structure

Recommended structure:

### Phase 1: Pre-training orientation

Duration: `15-20 min`

Purpose:

- explain what FLORA is
- explain what Hidro does
- explain which rooms are live now
- explain that FLORA is a local-first OR documentation system
- explain that manual workflow and automatic capture must coexist

Users should understand:

- patient monitor / anesthesia machine data may auto-populate
- some information still must be entered manually
- FLORA is a documentation system, not a physiologic monitor replacement

### Phase 2: Core workflow training

Duration: `45-60 min`

Purpose:

- teach one complete standard case workflow

This is the most important session.

### Phase 3: Exception and troubleshooting training

Duration: `20-30 min`

Purpose:

- teach what to do when data are missing
- teach how to continue safely if integration is incomplete

### Phase 4: Report and case closing

Duration: `20-30 min`

Purpose:

- teach report review
- teach discharge / archive workflow
- teach what must be checked before finishing a case

### Phase 5: Super-user / room champion session

Duration: `30-45 min`

Purpose:

- deeper training for selected key users
- basic troubleshooting and escalation
- startup / restart / support communication

---

## 5. Core workflow training sequence

This should be taught as one continuous case story.

### Step 1: Start of day / before first case

Teach users to check:

- FLORA opens correctly
- Hidro is running
- room/device connection looks normal
- printer/report path is available if used

Do not start with advanced settings.
Start with “how to know the room is ready.”

### Step 2: Create or open the case

Teach:

- admit / start case
- patient page basics
- when to use HIS data if available
- when manual patient entry is still needed

Focus on:

- HN
- AN if used
- key demographics
- allergy / lab / basic patient information if part of workflow

### Step 3: Watch automatic data capture

Teach users to distinguish:

- data coming from patient monitor
- data coming from anesthesia machine
- information that must still be charted manually

Do not over-teach technical detail.
Just make users confident in reading whether the data flow is present or absent.

### Step 4: Chart the case during anesthesia

This should be the main working block.

Teach:

- chart view basics
- event entry
- fluid and medication entry
- bolus
- drip
- fluid
- blood product workflow currently used in the room

Users should understand:

- automatic vital signs do not replace event documentation
- drug/fluid entry still needs correct human action
- report quality depends on correct workflow during the case

### Step 5: Form documentation

Teach only the clinically important current forms first:

- case information
- line
- invasive line / central line / arterial line workflow
- extubation if relevant
- PNB / neuraxial block if relevant to that service

Do not try to teach all form combinations in one session.
Train by common case type first.

### Step 6: Staff assignment

Teach:

- how to assign staff
- how to search and add current case staff
- when to save case staff

This should be short and practical.

### Step 7: Review before report

Teach users to do a quick review:

- timeline is present
- key events are present
- fluid/med entries are reasonable
- required forms are completed enough for report use

---

## 6. Exception and troubleshooting training

This should be a separate short session.

Teach only the most common real problems:

### 6.1 Missing patient monitor data

Users should know:

- how to recognize it
- how to continue documenting safely
- when to check physical cable / USB hub switch
- when to call local support

### 6.2 Missing anesthesia machine data

Users should know:

- same principle as monitor workflow
- what still can be documented manually

### 6.3 Both device feeds missing

Users should know:

- continue clinical care first
- continue manual documentation if needed
- use the quick troubleshooting guide
- escalate to room champion / support

### 6.4 Wrong case timing / case overlap / discharge questions

Users should know:

- what discharge means
- what archive means
- why old case/new case separation matters

---

## 7. Report training

Report training should answer only practical questions:

- how to review the report
- what must appear before printing
- which data are usually missing because of workflow, not because of software
- how to print / save PDF

Users do not need PDF architecture explanation.
They need a final checklist before using the report.

Suggested checklist:

- patient identity correct
- timeline present
- key events present
- fluid/med present
- line / form summary present if relevant

---

## 8. Recommended training sessions

For rollout use, a simple sequence is recommended:

### Session 1: Introduction + normal case workflow

Duration: `60-75 min`

Content:

- what FLORA does
- how to start a case
- chart workflow
- fluid / med workflow
- simple form workflow

### Session 2: Report + troubleshooting

Duration: `45-60 min`

Content:

- report review
- discharge / archive
- missing data troubleshooting
- USB hub switch / Hidro basics

### Session 3: Room super-user session

Duration: `30-45 min`

Content:

- deeper troubleshooting
- startup checks
- escalation flow
- how to collect problem details for support

---

## 9. Training method

Best method:

- short live demo
- then one guided mock case
- then one supervised real use

Do not rely on slide presentation only.

Recommended mix:

- `20%` explain
- `40%` live demonstration
- `40%` user hands-on practice

---

## 10. Materials to prepare

Training should be supported by these materials:

- full user manual
- quick start guide
- troubleshooting guide A4
- troubleshooting quick card A5
- room-specific cheat sheet if needed
- report review checklist

---

## 11. Proposed rollout order

Because FLORA is already live in `701`, `508`, and `901`, training should be staged like this:

### Stage 1: stabilize live-room users

Priority:

- users already working in `701`, `508`, `901`
- ensure consistent workflow first

### Stage 2: identify room champions

Choose at least:

- 1 doctor champion
- 1 nurse / support champion
- 1 technical support contact

### Stage 3: convert workflow into official manual

After repeated training and feedback:

- finalize the official user manual
- finalize quick troubleshooting material
- finalize report checklist

---

## 12. What the first official training should cover

If only one first official training session is possible, it should cover these minimum topics:

1. What FLORA is and what Hidro does
2. How to start/open a case
3. What data are automatic and what are manual
4. How to enter events, fluids, bolus, drips, and blood product workflow currently used
5. How to complete essential forms
6. How to review and print the report
7. What to do when monitor or machine data are missing

---

## 13. Suggested next document set

After this training-flow draft, the next recommended documents are:

1. `FLORA Quick Start Guide`
2. `FLORA Official User Manual`
3. `FLORA Report Review Checklist`
4. `FLORA Room Troubleshooting Card`

