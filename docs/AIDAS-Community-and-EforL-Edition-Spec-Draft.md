# AIDAS Community and E for L Edition Spec Draft

Prepared from doctor handwritten requirement in [6423.jpg](c:/Users/onlys/Aidas/docs/6423.jpg).

This draft is meant to help us turn the note into a clearer product-edition structure before implementation.

## 1. Main interpretation

The requirement is no longer only:

- `AIDAS RCAT Community Edition`

It is now:

- `AIDAS RCAT Community Edition`
- `AIDAS E for L Partner Edition`

Both appear to be free or special-distribution editions, but they serve different purposes.

## 2. Edition positioning

### 2.1 RCAT Community Edition

Target:

- Royal College / academic / community / broad introductory use

Identity from note:

- `Logo porjai + RCAT`
- strongly limited and simplified version
- oriented toward manual use and basic documentation

### 2.2 E for L Partner Edition

Target:

- partner edition for `E for L`
- more capable than RCAT edition
- still limited compared with full AIDAS
- likely intended as a curated partner package with some library and formula support

Identity from note:

- `Logo porjai + E for L`
- more workflow support than RCAT edition
- more monitor and ventilator flexibility

## 3. Feature comparison from handwritten note

## 3.1 Branding

### RCAT Community Edition

- logo: `Porjai + RCAT`

### E for L Partner Edition

- logo: `Porjai + E for L`

## 3.2 Timeline scale

### RCAT Community Edition

- scale: `1, 5 min`

### E for L Partner Edition

- scale: `1, 3, 5`

Interpretation:

- RCAT stays more restricted
- E for L gets one extra timeline resolution option

## 3.3 Report mode

### RCAT Community Edition

- print: `standard mode`

### E for L Partner Edition

- print: `standard, smart fit`

Interpretation:

- RCAT does not get advanced print fitting
- E for L gets at least `smart fit`

## 3.4 Monitor parameters

### RCAT Community Edition

Doctor note says:

- parameters / monitor: `(10)`
- includes:
  - `NIBP (Systolic, Diastolic, Mean)`
  - `SpO2`
  - `HR (EKG)`
  - `Temp`
  - `Arterial (Systolic, Diastolic, Mean)`
  - `CVP`

Doctor note also says:

- graph: can show only `3 values`
  - `NIBP`
  - `SpO2`
  - `HR (EKG)`

Interpretation:

- monitor capture/selection is intentionally restricted
- graph display is even more restricted than parameter list

### E for L Partner Edition

Doctor note says:

- parameters / monitor: `(10+)`
- base list appears same as RCAT
- plus examples such as:
  - `TOF`
  - `PPV / PPI`
  - and more

Doctor note also says:

- graph: `full`

Interpretation:

- E for L gets broader monitor parameter support
- E for L does not have the RCAT graph restriction

## 3.5 Ventilator parameters

### RCAT Community Edition

Doctor note says:

- ventilator: `(7)`
- includes:
  - `Mode`
  - `TV`
  - `RR`
  - `PEEP`
  - `FiO2`
  - `ETCO2`
  - `ETAG`

### E for L Partner Edition

Doctor note says:

- ventilator: `(7+)`
- includes RCAT-style baseline plus additional items such as:
  - `MAC`
  - `Peak airway pressure`
  - `I:E`
  - `Total flow`
  - and more

Interpretation:

- RCAT gets a practical minimal ventilator subset
- E for L gets expanded ventilator detail

## 3.6 Shortcut menu

### RCAT Community Edition

- no explicit shortcut-menu enhancement noted

### E for L Partner Edition

- note says `+ shortcut menu`

Interpretation:

- E for L gets some faster curated workflow actions

## 3.7 IV fluid / blood

### RCAT Community Edition

Doctor note says:

- `IV fluid / blood`
- `Blank chart (man. Fill)`
- `No formular cal. / library`

Interpretation:

- manual charting allowed
- no built-in formula calculation
- no built-in library support

### E for L Partner Edition

Doctor note says:

- `IV fluid / blood`
- examples:
  - `NSS`
  - `Acetar`
  - `5% D/N/2`
- `+ Formular cal.`
- margin note says `Library บางตัว`

Interpretation:

- E for L gets partial library support
- E for L gets formula calculation support
- E for L may ship with a curated subset of common fluid items

## 3.8 Agents

### RCAT Community Edition

Doctor note says:

- `Agents`
- `Blank chart (man. Fill)`
- `NO Formular cal.`

Interpretation:

- manual agent charting only
- no formula calculator

### E for L Partner Edition

Doctor note says:

- `Agents`
- `+ Formular cal.`

Interpretation:

- E for L gets formula-assisted agent workflow

## 3.9 I/O balance

### RCAT Community Edition

- text `I/O balance` appears crossed out

Interpretation:

- likely removed from RCAT edition
- needs confirmation whether this means:
  - feature hidden entirely
  - or balance calculation disabled

### E for L Partner Edition

- `I/O balance` is present

Interpretation:

- E for L keeps this feature

## 3.10 Staff and user management

### RCAT Community Edition

Doctor note says:

- `User`
  - `Admin 1`
  - `User 5-10`

Interpretation:

- RCAT has restricted user count
- earlier RCAT idea of `1 admin + limited users` still fits this note

### E for L Partner Edition

Doctor note says:

- `Staff: with Library staff`
- `User`
  - `Admin`
  - `User`

Interpretation:

- E for L may include preloaded or partner-managed staff library
- user policy still needs clarification

## 3.11 Database / deployment behavior

### RCAT Community Edition

Doctor note says:

- `Database: ปีต่อปี`

Interpretation:

- likely same annual rollover / yearly database separation concept discussed before

### E for L Partner Edition

Doctor note says:

- `DB: Import + Export to other rooms`
- `no stat. report`
- `1 yr register by E for L`

Interpretation:

- E for L may support room-to-room import/export
- statistical report may still be disabled
- licensing/registration may be time-based or partner-managed

## 3.12 Blood Tx page

Both editions have a highlighted note:

- `Blood Tx page`

Interpretation:

- blood transfusion page / workflow is intended to exist in both editions
- this is important because it was specifically highlighted, not casually listed

## 4. Best current product interpretation

Based on the handwritten note, the editions likely become:

### AIDAS Full Edition

- full commercial / full hospital capability

### AIDAS RCAT Community Edition

- free / community / academic / broad introductory version
- strongly limited
- manual-first
- no library / no formula calculator
- limited graphing and print capability

### AIDAS E for L Partner Edition

- free or partner-distributed special edition
- more capable than RCAT
- curated workflow support
- partial library
- formula calculators
- broader graph / monitor / ventilator support
- still not full enterprise edition

## 5. Recommended clean wording for editions

To avoid confusion, I would recommend:

### Option A

- `AIDAS Full Edition`
- `AIDAS RCAT Community Edition`
- `AIDAS E for L Partner Edition`

### Option B

- `AIDAS Full Edition`
- `AIDAS Community Edition (RCAT)`
- `AIDAS Partner Edition (E for L)`

Option B is slightly cleaner in product structure.

## 6. Items that still need confirmation

These points are visible in the note but still need explicit confirmation before implementation:

1. Does `graph full` in E for L mean unlimited graph series, or just more than RCAT's 3-graph limit?
2. Does `parameters / monitor (10+)` mean technically unlimited, or curated expansion only?
3. Does `library บางตัว` mean:
   - some fluid library only
   - fluid + agent library
   - or partial master data in general?
4. Does `I/O balance` being crossed out in RCAT mean hidden page, or no automatic calculation?
5. Does `1 yr register by E for L` mean:
   - one-year activation
   - annual renewal
   - or yearly partner-controlled license?
6. Does `no stat. report` apply only to E for L, or also RCAT?
7. Should `Blood Tx page` in RCAT and E for L be:
   - same page with different limits
   - or full workflow only in E for L and simpler page in RCAT?

## 7. Recommended next step

The best next deliverable is a formal edition matrix with columns:

- feature area
- full edition
- RCAT community edition
- E for L partner edition
- note / implementation comment

That would let us move from handwritten product idea into actual build scope.

