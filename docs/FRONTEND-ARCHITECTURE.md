# Flora Frontend Architecture

This document explains how the current Flora React frontend is assembled, how data moves through it, what the browser DOM looks like, and which rules matter when extending the clinical UI.

## 1. Technology baseline

The frontend lives in `frontend/` and currently uses:

- React 19 with TypeScript
- Vite 7 for development, HMR, and production bundling
- Tailwind CSS 4 plus application CSS variables in `src/index.css`
- Browser `fetch` through typed modules in `src/api/`
- React Context for theme and menu-language state
- Browser storage for fast local preference restoration
- Backend preference APIs for preferences that must follow the signed-in user
- Optional Electron APIs exposed through `window.floraDesktop`

There is no React Router in the current application. Navigation is workstation-style: `App` owns an `activeView` state, and `MainArea` selects the view component to render.

## 2. Application startup

`src/main.tsx` is the browser entry point.

```text
index.html
└── #root
    └── React.StrictMode
        └── ThemeProvider
            └── LanguageProvider
                └── App
```

Startup performs these operations in order:

1. Installs the authenticated-fetch wrapper.
2. Mounts React into `#root`.
3. Restores and applies the user's theme.
4. Restores and applies the menu language.
5. Lets `App` validate the stored authentication session.
6. Displays either `LoginPage` or the authenticated application shell.

`React.StrictMode` remains enabled. Development renders and effects may therefore run more than once to reveal unsafe component behavior.

## 3. Top-level ownership

`src/App.tsx` is the application coordinator. It owns state that affects the entire workstation:

- authenticated user
- bootstrap readiness
- current case status
- active view
- open/collapsed navigation state
- shutdown dialog state

The authenticated DOM shell is:

```text
App
└── div.app-shell
    ├── TopBar
    ├── div (main horizontal shell)
    │   ├── AppSidebar
    │   └── div.app-main
    │       └── MainArea
    └── shutdown overlay (only while open)
```

`TopBar` owns global workstation actions. `AppSidebar` owns primary navigation. `MainArea` owns the currently selected page.

Case status is deliberately held above the page components. Starting, opening, discharging, or updating a case can therefore update the top bar, sidebar, chart, report, and forms from one authoritative state.

## 4. Navigation and view loading

`src/layout/MainArea.tsx` maps `activeView` to the corresponding page:

| View key | Component | Primary responsibility |
| --- | --- | --- |
| `case` | `IdleCaseLanding` or `ClinicalChartView` | Prepare a case or show the live chart |
| `form` | `FormView` | Perioperative documentation forms |
| `diagnosis` | `DiagnosisView` | Diagnoses and procedures |
| `io` | `InputOutputBalanceView` | Medication, fluid, blood product, and output balance workflow |
| `patient` | `PatientView` | Patient information |
| `staff` | `StaffView` | Case staff |
| `report` | `ReportView` | Review and printable report |
| `master` | `ManageView` | Master data and configuration |
| `account` | `AccountView` | User preferences |
| `history` | `HistoryView` | Archived/recent cases |
| `fleet` | `CanopyFleetView` | Canopy workstation overview |

The heaviest views are loaded with `React.lazy`, while frequently accessed smaller views are imported normally. `Suspense` supplies the loading state.

Every selected view is wrapped by `ViewErrorBoundary`. A render exception therefore replaces the main content with **View failed to load** without destroying the top bar or navigation. Changing the view or case changes the boundary reset key and clears the failed state.

Case-scoped pages receive a React `key` containing the case ID and status. Opening a different case intentionally remounts those pages so transient form state cannot leak between patients.

## 5. Source organization

```text
src/
├── api/          Typed HTTP functions and response normalization
├── assets/       Raster artwork and icon sheets
├── auth/         Login UI and session hook
├── bootstrap/    Backend/bootstrap readiness
├── components/   Reusable clinical and structural components
│   ├── case/
│   ├── clinical-timeline/
│   ├── common/
│   └── vitals/
├── context/      Theme and menu-language providers
├── edition/      Leaf/Canopy and edition capabilities
├── hooks/        Reusable data and viewport hooks
├── layout/       Global shell, navigation, and rails
├── utils/        Formatting, preference, and display helpers
└── views/        Page-level workflow components
```

The intended dependency direction is:

```text
views/layout
    ↓
components + hooks
    ↓
api + utils + shared types
```

API modules must not import UI components. Reusable components should not own page navigation or global case selection.

### Domain naming rules

Names describe the clinical responsibility, not the first UI prototype that happened to use the code.

| Name | Meaning |
| --- | --- |
| `ClinicalChartView` | The complete live anesthetic chart workspace |
| `ClinicalTimelineGrid` | Timeline-aligned events, I/O, ECG, and observation rows |
| `ClinicalTimelineAxis` | The shared timestamp header for the clinical timeline |
| `VitalSignsTrendChart` | The SVG trend visualization for vital signs |
| `InputOutputBalanceView` | The case workflow for medication, fluid, blood product, and output records |
| `IoCatalogItem` | Any configured I/O item: medication, fluid, blood product, urine, blood loss, or another supported output |
| `Medication` or `drug` | Medication-only data and workflows |

Do not use `drug` as an umbrella term for fluid or output data. The API endpoint may retain a legacy server path for compatibility, but frontend modules and types must expose the correct domain meaning.

## 6. Data access and normalization

UI components do not call raw URLs directly. Functions under `src/api/` own:

- endpoint paths
- request and response types
- authentication headers through the installed fetch wrapper
- conversion of nullable or loosely typed JSON into frontend-safe values
- domain-specific API operations

Important domains include case status, case details, clinical records, events, I/O catalog, medications, vitals, clinical timeline, HIS exchange, staff, workstation settings, terminology, and fleet status.

A typical live-chart flow is:

```text
flora-leaf-api
    ↓ HTTP JSON
src/api/clinicalTimelineApi.ts + src/api/vitalMinutesApi.ts
    ↓
useClinicalTimelineAxis + useVitalMinutes
    ↓ normalized ClinicalTimelineValues
ClinicalChartView
    ├── ClinicalTimelineAxis
    ├── ClinicalTimelineGrid
    └── VitalSignsTrendChart
```

`ClinicalTimelineValues` is a sparse row-first structure:

```ts
{
  hr: {
    1789701000000: 76,
    1789701060000: 75,
  },
  spo2: {
    1789701000000: 98,
  },
}
```

This lets the table and SVG chart share one clinical value model.

## 7. Live chart component and DOM architecture

`ClinicalChartView` is the live-case composition root. It coordinates case events, I/O runs, observations, modal workflows, timeline scale, scroll synchronization, optimistic edits, and polling.

The important chart DOM is conceptually:

```text
ClinicalChartView
└── case page shell
    ├── case information / warnings
    ├── case-kronos toolbar
    │   ├── minute-scale control
    │   ├── synchronization state
    │   ├── case-info alignment control
    │   └── parameter control
    └── div.case-timeline-scroll
        ├── current-time vertical overlay
        ├── ClinicalTimelineAxis
        ├── ClinicalTimelineGrid (events and I/O section)
        ├── VitalSignsTrendChart (SVG vital graph)
        └── ClinicalTimelineGrid (observation table section)
```

The timeline pieces receive the same:

- `axis`
- `scrollLeft`
- `viewportWidth`
- column width
- sticky-label width
- current server-adjusted time

This is what keeps headers, events, chart points, I/O entries, and table observations horizontally aligned.

### ClinicalTimelineAxis

`ClinicalTimelineAxis` renders timestamp cells and the NOW cell/badge. It uses a sticky first column and left/right spacer elements so only visible timestamps create DOM nodes.

### ClinicalTimelineGrid

`ClinicalTimelineGrid` is a semantic HTML table. Its first cell is sticky, while timeline cells are horizontally virtualized.

For a long case, the DOM is approximately:

```text
table
└── tbody
    └── tr × visible rows
        ├── td.sticky-label
        ├── td.left-spacer
        ├── td × visible timeline columns
        └── td.right-spacer
```

The spacer cells preserve the total scroll width without mounting every off-screen clinical cell.

I/O type markers use a maximum of six ordered color sticks per time bucket:

1. medication bolus
2. medication drip
3. fluid
4. blood product
5. blood loss
6. urine

Repeated entries of the same type share a stick; the tooltip carries the item names.

### VitalSignsTrendChart

`VitalSignsTrendChart` renders an SVG over the same timeline width. It draws:

- horizontal clinical scale/grid lines
- visible vertical time lines
- vital polylines and markers
- NIBP/ART vertical range connectors
- NOW highlight and rule
- transparent hover rectangles for column tooltips

Historical series are normalized and sorted in a memoized step. Scrolling only projects the visible buffered range into SVG coordinates. A NOW update must not rescan the complete 40-hour history.

## 8. Input/output balance view

`InputOutputBalanceView` is the composition root for the I/O workflow. Its main current-case layout contains:

```text
InputOutputBalanceView
├── compact case identity
├── intake/output/balance/drip totals
├── four quick actions
│   ├── Med bolus
│   ├── Med drip
│   ├── Fluid
│   └── Blood product
└── two-column content where space allows
    ├── Fluids Balance
    │   ├── Intake
    │   └── Output
    └── Medication Summary
```

Medication Summary and Fluids Balance each have independent icon-only summary/detail preferences.

- Summary mode shows item name and total.
- Detail mode shows type information, total, records, and actions.
- The last selected mode is restored from browser storage.

The six I/O visual identities are:

| Type | Color |
| --- | --- |
| Medication bolus | `#5B8FF9` |
| Medication drip | `#9B6DFF` |
| Fluid | `#39C6C8` |
| Blood product | `#E05252` |
| Blood loss | `#8B2635` |
| Urine | `#D99A24` |

These colors are reused in action cards, detail cards, chart-row rules, timeline sticks, tooltips, and reports. A type must not acquire a different color in another view.

## 9. State categories

Flora uses several state scopes rather than one global store.

### Component-local state

Used for modal visibility, drafts, focused selections, dropdowns, temporary errors, and unsaved input.

### App-owned state

Used for authenticated user, active view, case status, and navigation shell state.

### Context state

Used for theme and menu language because those concerns affect most of the component tree.

### Server state

Fetched by view components and custom hooks. Active clinical data is periodically refreshed and also refreshed after local writes.

### Browser persistence

Used for immediate UI restoration, including navigation collapse, view modes, chart visibility, smart contrast, theme, and selected local preferences.

### Account preference persistence

Preferences that should follow a user between workstations are also synchronized through the account API. Local storage is the fast startup cache, not always the only source of truth.

## 10. Cross-view update events

The frontend uses browser `CustomEvent` messages for small cross-view invalidation signals. Examples include:

- `flora:auth-changed`
- `flora:case-hn-updated`
- `flora:case-start-time-updated`
- `flora:case-io-changed`
- `flora:case-events-changed`
- the chart-preference changed event

The payload should contain identifiers, not a second copy of the entire clinical record. Listeners use the signal to refresh or update their authoritative state.

Every event listener added in an effect must be removed by that effect's cleanup function.

## 11. Polling and current time

The live page combines event-driven refreshes with conservative polling:

- time axis: periodic refresh while the case is active
- effective vital timeline: periodic refresh while active
- case events and I/O: periodic refresh plus custom-event invalidation
- NOW display: server-offset local time heartbeat

The NOW heartbeat is intentionally slower than one second because the clinical timeline is minute-scale. It must not force full-history recomputation.

Polling effects must:

1. stop when the component unmounts;
2. stop or change behavior for discharged/archived cases;
3. ignore late responses after cleanup;
4. preserve the previous object when returned data is unchanged where practical.

## 12. Rendering and performance rules

Long cases are normal, not exceptional. A 40-hour case may contain thousands of minute values.

Required rules:

- Virtualize horizontal timeline columns.
- Keep off-screen width with spacer elements, not hidden DOM cells.
- Memoize normalized historical series.
- Bucket events and I/O in one pass; never filter the complete history once per axis column.
- Keep `values` object identity stable when data is unchanged.
- Avoid putting full-history transformations directly in the component render body.
- Avoid nested scroll areas for page content.
- Use stable keys based on case/run/item identifiers.
- Keep tooltip calculation limited to visible columns.
- Treat every timer or scroll state update as a possible full component render.

## 13. React hook safety

Hooks must execute in the same order on every render.

Incorrect:

```tsx
if (axis.length === 0) return null;
const points = useMemo(() => buildPoints(values), [values]);
```

The first render may return before `useMemo`, while a later loaded render reaches it. React then throws because the hook count changed.

Correct:

```tsx
const points = useMemo(
  () => axis.length === 0 ? [] : buildPoints(values),
  [axis.length, values],
);

if (axis.length === 0) return null;
```

All hooks must run before conditional returns unless the conditional is structurally outside the component containing those hooks.

This rule is especially important for data-loading components because their first render commonly has an empty axis or no records.

## 14. Styling and theming

The theme provider applies scheme information to the root `<html>` element:

- visual `light` or `dark` class
- `theme-{scheme}` class
- `data-flora-theme` attribute
- palette CSS variables

Components should prefer semantic application variables such as:

- `--app-bg`
- `--app-panel-bg`
- `--app-control-bg`
- `--app-border`
- `--app-text`
- `--app-muted`
- `--app-accent`
- `--app-hover-bg`

This prevents tooltips, modals, and cards from remaining dark inside a light scheme.

Clinical type colors are an exception: their semantic identity remains stable across schemes, but backgrounds, borders, and text contrast may use alpha variants.

## 15. Language and patient-name display

Menu language and patient-name display are separate preferences.

- `LanguageContext` controls application/menu strings.
- Patient-name formatting utilities select the configured patient-name language wherever identity is displayed.

Changing the menu language must not silently change which patient name is shown.

## 16. Error boundaries and debugging

`ViewErrorBoundary` protects the main workspace from a page-level render exception. It logs the original exception to the browser console and shows a retry action.

When **View failed to load** appears:

1. inspect the first browser-console exception;
2. identify whether it is a lazy-chunk, hook-order, null-data, or render error;
3. reproduce the transition that triggers it, not only a fresh loaded state;
4. test empty, loading, populated, and case-switch states;
5. run the production build;
6. perform a full page reload if Fast Refresh preserved a failed component instance.

A successful TypeScript build does not prove hook-order safety because hook order is a runtime property.

## 17. Validation before handoff

At minimum, frontend work should pass:

```powershell
cd frontend
npm run build
```

For behavior changes, verify the relevant transitions:

- unauthenticated to authenticated
- idle case to active case
- empty data to loaded data
- one case to another case
- summary to detail and page reload
- dark and light schemes
- short and 40-hour timelines
- narrow and wide workspaces
- active to discharged case where applicable

Also run `git diff --check` from the repository root before handoff.

## 18. Current architectural pressure points

`ClinicalChartView` and `InputOutputBalanceView` are large workflow components. They work as composition roots, but additional features should increasingly be extracted into:

- focused modal components
- pure transformation utilities
- domain hooks for fetching and mutation
- small summary/detail components
- shared I/O visual-identity utilities

The goal is not abstraction for its own sake. Extraction is valuable when it isolates a clinical workflow, prevents repeated logic, reduces render work, or makes failure boundaries easier to understand.
