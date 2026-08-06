-- The original check constraint only allowed feature/complaint/other. People
-- mostly want to ask for a new data source, which deserves its own category
-- rather than being flattened into "feature".
alter table support_requests drop constraint if exists support_requests_kind_check;

alter table support_requests
  add constraint support_requests_kind_check
  check (kind in ('source', 'feature', 'bug', 'other'));
