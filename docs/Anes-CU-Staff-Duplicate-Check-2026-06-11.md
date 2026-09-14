# Anes CU Staff Duplicate Check

Source file:

- [Anes CU-staffs V3 mar-2569.xlsx](c:/Users/onlys/Flora/docs/Anes%20CU-staffs%20V3%20mar-2569.xlsx)

Check date:

- 2026-06-11

## Summary

The Excel sheet contains **97 non-empty rows**.

### Hard duplicate conflicts

These are the duplicates that can break sync and user creation because they use the same identity key.

#### Duplicate hospital ID `7278500`

- Row 20: `Kirada Apisutimaitri`
- Row 21: `Kornkamon Yuwapattawong`

This is a real conflict. Both rows use the same hospital ID, so the system cannot safely keep both as separate staff identities.

#### Duplicate hospital ID `7271234567`

- Row 29: `Name Surename`
- Row 35: `Patcharapon Juntamud`

This also conflicts, but it strongly looks like example or placeholder data rather than real staff data.

## Other duplicate categories

### Duplicate English names

- None found

### Duplicate emails

- None found

### Duplicate Innovian IDs

- None found

### Duplicate Thai names

There are many duplicate Thai-name strings, but these do **not** appear to be identity conflicts by themselves.

In this dataset they mostly represent different people whose Thai names happen to normalize the same way in the exported text.

Because the hospital IDs are different, these rows are not the main sync problem.

## Main conclusion

The important duplicates to fix are:

1. `7278500`
   - `Kirada Apisutimaitri`
   - `Kornkamon Yuwapattawong`

2. `7271234567`
   - `Name Surename`
   - `Patcharapon Juntamud`

The first looks like a real staff-ID conflict.

The second looks like test/example data and should probably be removed or corrected before import.

## Impact on FLORA sync

The staff sync process uses `hospital_id` as one of the main identity keys.

If two different people share the same `hospital_id`:

- one row may overwrite the other
- the wrong staff name may remain in `staff_directory`
- the wrong username may remain in `auth_user`
- the missing person may appear as “not imported” even though the source file contains them

This is exactly what happened with `Kirada`.

## Recommended action

Before final sync/import:

1. confirm who really owns `hospital_id 7278500`
2. remove or correct the example/test entry around `7271234567`
3. rerun the staff sync after the Excel source is corrected

## HIS confirmation update

From the HIS source files added later:

- [doctor_ANES_25690506 (1).xlsx](c:/Users/onlys/Flora/docs/doctor_ANES_25690506%20(1).xlsx)
- [doctor_other_25690506 (1).xlsx](c:/Users/onlys/Flora/docs/doctor_other_25690506%20(1).xlsx)

Confirmed mapping:

- `Kirada Apisutimaitri` = `7278500`
- `Kornkamon Yuwapattanawong` = `7279200`

This means the old CU staff Excel row that gave `Kornkamon` the same `7278500` as `Kirada` was incorrect.
