# AIDAS Edition Architecture Plan

Goal:

- keep one shared AIDAS codebase
- support multiple editions
- build a separate installer such as `Aidas-EforL`

## 1. Editions

Planned editions:

- `full`
- `rcat`
- `eforl`

These are editions of the same product, not separate repos.

## 2. Build strategy

We should build E for L separately as:

- application name: `Aidas EforL`
- installer name: `Aidas-EforL-Setup-<version>.exe`

But internally it should still use the same:

- frontend
- backend
- database schema
- report engine

## 3. Technical model

Add one edition config layer:

- `shared/editionConfig.ts`

Example shape:

```ts
export type AidasEdition = "full" | "rcat" | "eforl";

export type EditionCapabilities = {
  brandName: string;
  installerName: string;
  logoVariant: "full" | "rcat" | "eforl";
  timelineScales: number[];
  printModes: Array<"standard" | "smartfit" | "detail">;
  graphMode: "limited" | "full";
  graphParameterLimit?: number;
  monitorParameterLimit?: number | null;
  ventilatorParameterLimit?: number | null;
  allowFormulaCalculator: boolean;
  allowLibrary: "none" | "partial" | "full";
  allowShortcutMenu: boolean;
  allowIoBalance: boolean;
  allowStatReport: boolean;
  allowRoomImportExport: boolean;
  bloodTxPage: boolean;
};
```

Then define:

- `FULL_CAPABILITIES`
- `RCAT_CAPABILITIES`
- `EFORL_CAPABILITIES`

## 4. Runtime source of edition

Edition should come from environment/config first, for example:

- `AIDAS_EDITION=full`
- `AIDAS_EDITION=rcat`
- `AIDAS_EDITION=eforl`

That value should be read once at startup and exposed to:

- frontend
- backend
- Electron shell

## 5. Frontend changes

Frontend should gate behavior by edition config, not by scattered `if` statements.

Main areas to control:

- top branding and logo
- theme defaults
- timeline scale choices
- graph limit behavior
- monitor parameter selection
- ventilator parameter selection
- print mode buttons
- report options visibility
- shortcut menu visibility
- fluid/agent formula calculator visibility
- library visibility
- I/O balance visibility
- blood tx page visibility or mode

## 6. Backend changes

Backend mostly stays shared.

Backend edition checks are needed only where business rules matter, such as:

- restricting report modes
- restricting import/export APIs
- restricting statistical report endpoints
- optional blood tx workflow limits

## 7. Electron and installer changes

Electron/package build should support edition-specific metadata:

- window title
- product name
- installer artifact name
- icon or logo variant if needed

Likely approach:

- keep one base `package.json`
- add small build wrapper scripts

Examples:

- `scripts/build-aidas-full.ps1`
- `scripts/build-aidas-rcat.ps1`
- `scripts/build-aidas-eforl.ps1`

These scripts can set environment variables before calling the existing package flow.

Example:

```powershell
$env:AIDAS_EDITION='eforl'
$env:AIDAS_PRODUCT_NAME='Aidas EforL'
$env:AIDAS_INSTALLER_BASENAME='Aidas-EforL-Setup'
npm run desktop:package:win
```

## 8. Recommended implementation order

### Phase 1

- add edition config model
- default everything to `full`
- expose edition to frontend/backend

### Phase 2

- gate easy UI-only features
  - branding
  - timeline scales
  - print mode buttons
  - graph limits
  - library / formula calculator visibility

### Phase 3

- gate report/backend capability differences
  - statistical report
  - import/export
  - optional blood tx behavior

### Phase 4

- add separate installer outputs
  - `Aidas-Setup`
  - `Aidas-RCAT-Setup`
  - `Aidas-EforL-Setup`

## 9. Why this is the right architecture

Benefits:

- one repo
- one bug-fix path
- one schema
- one shared clinical workflow core
- easier long-term maintenance
- easy to add more editions later

Avoid:

- repo fork
- duplicated frontend/backend folders
- separate branches per customer/edition

## 10. Immediate next step

First practical target:

- implement `AIDAS_EDITION`
- add `eforl` build identity
- hide/limit a few high-visibility features first

That is enough to produce the first separate `Aidas-EforL` installer while keeping the rest of the system shared.

