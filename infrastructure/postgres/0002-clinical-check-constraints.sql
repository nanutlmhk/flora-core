CREATE OR REPLACE PROCEDURE pg_temp.add_check(
  target_table text,
  constraint_name text,
  check_expression text
)
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = target_table
      AND c.conname = constraint_name
  ) THEN
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s)',
      target_table,
      constraint_name,
      check_expression
    );
  END IF;
END;
$$;

CALL pg_temp.add_check('cases', 'cases_status_check',
  $$status IN ('active', 'discharged', 'archived')$$);
CALL pg_temp.add_check('auth_user', 'auth_user_is_active_check',
  $$is_active IN (0, 1)$$);
CALL pg_temp.add_check('case_device_ingest_audit', 'case_device_ingest_audit_fetch_mode_check',
  $$fetch_mode IN ('minute', 'bulk')$$);
CALL pg_temp.add_check('case_device_ingest_audit', 'case_device_ingest_audit_status_check',
  $$status IN ('ok', 'empty', 'failed')$$);
CALL pg_temp.add_check('case_timeline_value', 'case_timeline_value_value_type_check',
  $$value_type IN ('number', 'text', 'code')$$);
CALL pg_temp.add_check('case_timeline_value', 'case_timeline_value_source_check',
  $$source IN ('manual', 'override')$$);
CALL pg_temp.add_check('case_timeline_audit', 'case_timeline_audit_action_check',
  $$action IN ('insert', 'update', 'delete')$$);
CALL pg_temp.add_check('case_event_note', 'case_event_note_event_type_check',
  $$event_type IN ('event', 'note')$$);
CALL pg_temp.add_check('case_event_note', 'case_event_note_is_deleted_check',
  $$is_deleted IN (0, 1)$$);
CALL pg_temp.add_check('case_event_note_audit', 'case_event_note_audit_action_check',
  $$action IN ('insert', 'update', 'delete')$$);
CALL pg_temp.add_check('case_detail', 'case_detail_case_type_check',
  $$case_type IN ('elective', 'emergency')$$);
CALL pg_temp.add_check('legacy_med_drip_preset_analysis', 'legacy_med_drip_weight_based_check',
  $$weight_based IN (0, 1)$$);
CALL pg_temp.add_check('legacy_med_drip_preset_analysis', 'legacy_med_drip_is_curated_check',
  $$is_curated IN (0, 1)$$);
CALL pg_temp.add_check('staff_directory', 'staff_directory_is_active_check',
  $$is_active IN (0, 1)$$);
CALL pg_temp.add_check('io_item_master', 'io_item_master_kind_check',
  $$kind IN ('fluid', 'med', 'output')$$);
CALL pg_temp.add_check('io_item_master', 'io_item_master_is_active_check',
  $$is_active IN (0, 1)$$);
CALL pg_temp.add_check('case_io_run', 'case_io_run_kind_check',
  $$kind IN ('fluid', 'med', 'output')$$);
CALL pg_temp.add_check('case_io_run', 'case_io_run_include_in_balance_check',
  $$include_in_balance IN (0, 1)$$);
CALL pg_temp.add_check('case_io_run', 'case_io_run_entry_mode_check',
  $$entry_mode IN ('bolus', 'drip')$$);
CALL pg_temp.add_check('case_io_segment', 'case_io_segment_include_in_balance_check',
  $$include_in_balance IN (0, 1)$$);
CALL pg_temp.add_check('case_io_event', 'case_io_event_kind_check',
  $$kind IN ('fluid', 'med', 'output')$$);
CALL pg_temp.add_check('case_io_event', 'case_io_event_include_in_balance_check',
  $$include_in_balance IN (0, 1)$$);
CALL pg_temp.add_check('case_io_audit', 'case_io_audit_entity_type_check',
  $$entity_type IN ('run', 'segment', 'event')$$);
CALL pg_temp.add_check('case_io_audit', 'case_io_audit_action_check',
  $$action IN ('insert', 'update', 'delete')$$);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flora_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO flora_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO flora_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO flora_app;
