# Account settings and staff identity

Flora separates personal settings from system configuration.

- **Account settings** are owned by the signed-in user: display name, preferred language and color scheme, default chart parameters, report sections, and password.
- **Config → User** is administrative: account activation, password reset, and linking a login account to a clinical staff-directory profile.
- **Config → Staff** defines the reusable clinical identities and international profile fields used in case staffing.

`auth_user.staff_directory_id` is the explicit optional one-to-one relationship to
`staff_directory.id`. The foreign key uses `ON DELETE SET NULL`, so removing a
staff identity does not delete the login account. Existing installations are
backfilled where an active staff profile has the same hospital ID. A partial
unique index prevents one staff identity from being assigned to multiple users.

Chart and report preferences are JSONB so the UI can add future choices without
adding one database column per checkbox. Clinical records remain independent of
these display preferences.
