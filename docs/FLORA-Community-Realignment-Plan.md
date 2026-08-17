# Flora Community Realignment Plan

This document defines how `Flora` should be positioned relative to private `AIDAS`.

The goal is not to make Flora a random cut-down copy of AIDAS.
The goal is to make Flora a clean public community product that is technically close to the current `EforL` edition baseline, but branded and governed as `Flora`.

## 1. Product decision

### AIDAS

- private commercial product owned by Porjai
- hospital deployment product
- full version plus partner/customer editions
- contains private deployment workflows, hospital-specific integration, and commercial support paths

### Flora

- public community AIMS software
- public repository product
- open development baseline
- community-facing branding and documentation
- no partner-specific branding or commercial lock-in behavior

## 2. Core decision for Flora

Flora should be:

- technically close to current `EforL` edition behavior
- visually branded as `Flora`
- cleaned for public release
- independent from `AIDAS` commercial branding

In short:

- `Flora = EforL-like baseline - EforL branding - AIDAS commercial identity + Flora identity`

## 3. Why EforL is the right baseline

Compared with the older RCAT/community draft, current `EforL` already has a better balance for a public product:

- more usable workflow than ultra-limited RCAT scope
- cleaner modern theme behavior
- stronger blood workflow showcase
- better monitor / ventilator flexibility
- still clearly limited compared with full AIDAS

That makes it a better starting point for a public community product.

## 4. Target Flora identity

Flora should have its own product identity, not “Aidas public edition”.

Recommended identity:

- product name: `Flora`
- desktop window title: `Flora`
- installer name: `Flora-Setup-<version>.exe`
- public repo name: `Flora`
- logo: `Flora logo` only
- no `EforL` logo
- no `Porjai + EforL` co-branding in community release

Optional wording:

- subtitle: `Community AIMS`
- or `Open Community Edition`

## 5. What Flora should keep from EforL baseline

### UI / desktop behavior

- edition-aware simplified UI
- light / dark only
- no large theme picker matrix
- cleaner bedside workflow

### Clinical workflow

- chart view
- form view
- patient view
- staff view
- fluid and medication workflow
- blood workflow page
- report generation

### Parameter scope

- use the same limited public-safe monitor / ventilator parameter strategy as EforL
- keep full AIDAS advanced expansion out of Flora by default

### Report options

- `Standard`
- `Smart Fit`

Keep:

- no `Detail` report mode in Flora baseline

### Blood workflow

- keep blood-board style workflow direction
- but remove partner/mock showcase wording tied to EforL sales/demo use

## 6. What Flora should NOT carry over from EforL

These parts are acceptable in a partner edition, but should not define the public community product.

### Partner branding

- `EforL` logo
- `Aidas EforL` product title
- partner-only wording in report or top bar

### Commercial license mockup

- machine-id activation page
- annual activation wording
- partner-controlled licensing flow

Recommendation:

- remove from Flora community baseline
- if needed later, Flora can have a simple About / Version page instead

### Partner database/export mockup

- EforL-specific database export mockups meant for commercial discussion

Recommendation:

- remove from initial Flora public product
- only add real export/import later when properly designed

### Sales-demo mock content

- static EforL blood-bank demo wording
- “showcase mode” wording tied to partner presentation

Recommendation:

- either remove
- or replace with neutral `demo mode` wording if needed for public sample data

## 7. What Flora must remove because it is public

Before pushing Flora as a real public community product, these must stay out:

- hospital-specific HIS gateways
- customer deployment scripts
- internal support utilities
- private incident reports
- activation / licensing logic for paid products
- partner-only branding assets
- internal documents for Porjai business operations
- customer names, room names, IPs, tokens, secrets, server details

## 8. Flora feature boundary

Recommended Flora boundary:

### Flora should include

- local standalone desktop workflow
- local SQLite database
- manual charting
- limited monitor / ventilator parameter model
- forms
- fluid / med / blood charting
- staff and patient workflow
- report generation
- public-safe sample or seed data
- clean technical documentation

### Flora should exclude

- private hospital integrations by default
- commercial licensing flow
- customer-specific deployment automation
- private partner branding
- full enterprise / full-hospital orchestration logic

## 9. Proposed implementation rule

When deciding whether a feature goes into Flora:

Ask:

1. Is this useful for a public community AIMS baseline?
2. Is this free from customer-specific dependency?
3. Is this free from private commercial branding?
4. Is this safe to publish as open/public code?

If the answer is not clearly yes, it should stay in AIDAS, not Flora.

## 10. Practical migration strategy

Do not mirror AIDAS blindly into Flora.

Use this order:

### Phase 1. Branding split

- rename product identity to `Flora`
- replace top-bar and report branding with Flora logo
- remove `Aidas EforL` naming

### Phase 2. Feature baseline lock

- use current `EforL` behavior as the starting UI/feature baseline
- keep only light/dark
- keep `Standard` + `Smart Fit`
- keep public-safe parameter limits

### Phase 3. Remove commercial / partner-specific layers

- remove license page
- remove database export mockup page
- remove EforL-specific showcase wording
- remove partner sales/demo assumptions

### Phase 4. Public repo hygiene

- clean docs
- remove internal files
- remove private deployment data
- verify branding and README

## 11. Recommended sync policy between AIDAS and Flora

### AIDAS -> Flora

Allowed when:

- the feature is generic
- the feature improves core clinical workflow
- the code does not contain private business or hospital-specific logic

Examples:

- generic UI improvements
- safer report rendering
- better manual charting UX
- form workflow improvements

### AIDAS -> Flora not allowed directly

Examples:

- customer-specific connectors
- paid licensing flows
- partner branding
- deployment scripts for private sites

### Flora -> AIDAS

Allowed when:

- community-safe improvements are also useful for commercial builds
- generic bug fixes improve the main product

## 12. Recommended immediate next step

For Flora repo, the first concrete pass should be:

1. adopt EforL as the technical baseline
2. replace all EforL identity with Flora identity
3. remove license/database mock pages
4. keep only public-safe docs and assets
5. rewrite README as a real public community product README

## 13. Short final rule

If we need one simple rule:

`Flora should feel like the public community version of the EforL-level experience, but with Flora branding and without partner/commercial baggage.`
