# FLORA Database Diagram Guide

Main Mermaid file:

- [FLORA-Database-Diagram.mmd](c:/Users/onlys/Flora/docs/FLORA-Database-Diagram.mmd)

## What this diagram shows

This is a simplified logical database diagram for FLORA, based on the current schema in [floradb.js](c:/Users/onlys/Flora/backend/floradb.js).

It focuses on the main groups:

- case core
- patient and clinical data
- timeline and events
- staff and authentication
- fluid / medication / output
- HIS cache and buffers
- master data

It intentionally does **not** include every audit table, because that would make the meeting slide too crowded.

## Main structure

### 1. Case core

- `cases` is the center of the system
- almost every clinical table is linked by `case_id`

### 2. Patient and clinical documentation

- `patient_snapshot`
- `case_detail`
- `case_diagnosis`
- `case_procedure`
- `case_allergy`

### 3. Timeline and chart data

- `vital_minutes`
- `case_timeline_value`
- `case_event_note`

### 4. Staff and user model

- `auth_user`
- `auth_session`
- `staff_directory`
- `staff_role`
- `case_staff`

### 5. Fluid / medication / output model

- `io_item_master`
- `case_io_run`
- `case_io_segment`
- `case_io_event`

### 6. HIS integration cache

- `case_his_patient`
- `case_his_allergy`
- `case_his_lab`
- `his_patient_buffer`
- `his_allergy_buffer`
- `his_lab_buffer`

### 7. Reference master data

- `icd10_master`
- `icd9cm_master`

## If you want a simpler slide version

For presentation, you can describe FLORA database in 5 blocks:

1. `Case Core`
2. `Clinical Documentation`
3. `Timeline and Events`
4. `Medication / Fluid / Output`
5. `HIS and Master Data`

## Prompt text for GPT image generation

If you want to create a polished diagram image using GPT or another design tool, use this prompt:

```text
Create a clean dark-theme database architecture diagram for a medical anesthesia system called FLORA.

Put "cases" at the center.

Show these groups around it:

1. Patient and Clinical Documentation
- patient_snapshot
- case_detail
- case_diagnosis
- case_procedure
- case_allergy

2. Timeline and Events
- vital_minutes
- case_timeline_value
- case_event_note

3. Staff and Users
- auth_user
- auth_session
- staff_directory
- staff_role
- case_staff

4. Fluid / Medication / Output
- io_item_master
- case_io_run
- case_io_segment
- case_io_event

5. HIS Integration
- case_his_patient
- case_his_allergy
- case_his_lab
- his_patient_buffer
- his_allergy_buffer
- his_lab_buffer

6. Master Data
- icd10_master
- icd9cm_master

Use arrows or relationship lines from cases to the case-related tables.
Show io_item_master linked to case_io_run and case_io_event.
Show case_io_run linked to case_io_segment.
Show staff_role linked to staff_directory and case_staff.
Show auth_user linked to auth_session.
Use a modern presentation style, simple labels, minimal clutter, and make it suitable for a hospital IT meeting slide.
```
