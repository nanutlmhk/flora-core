# Configurable staff profiles

Flora does not require a fixed Thai/English name layout. Each Leaf maintains an
ordered `staff_field_master` catalog. Administrators may add, relabel,
deactivate, reorder, or require fields without changing the staff tables or UI.

Each field defines an input type, optional language code, optional name part
(`prefix`, `given`, `middle`, `family`, or `suffix`), and an optional core
mapping. Core mappings preserve interoperability for hospital ID, display name,
email, personal ID, entry year, and Innovian ID.

Values are stored in `staff_directory.profile_data`. When staff are assigned to
a case, the current profile is copied into `case_staff.profile_data`; later
directory edits therefore do not rewrite the historical case snapshot.

Legacy TH/EN columns remain as compatibility fields for existing reports and
imports. Migration `0013-configurable-staff-profile.sql` copies those values
into the profile JSON without deleting or changing the original columns.

API endpoints:

- `GET /api/case/staff/fields`
- `POST /api/case/staff/fields` (admin)
- `PUT /api/case/staff/fields/{id}` (admin)
- `DELETE /api/case/staff/fields/{id}` (admin deactivation)
