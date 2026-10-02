-- MediMantra schema
--
-- Apply with:  psql "$DATABASE_URL" -f schema.sql
--
-- Row-level security below is enforced against a request-scoped setting,
-- `app.current_patient`, which the application sets inside every
-- transaction (see lib/db.ts -> withPatient).
--
-- IMPORTANT: Supabase's default `postgres` role has BYPASSRLS, so these
-- policies do nothing when you connect as it. The `app_user` role described
-- at the bottom of this file is the one DATABASE_URL should use.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------

do $$ begin
  create type patient_language as enum ('en', 'hi', 'te');  -- English, Hindi, Telugu
exception when duplicate_object then null; end $$;

do $$ begin
  create type food_instruction as enum ('before_food', 'after_food', 'with_food', 'anytime');
exception when duplicate_object then null; end $$;

do $$ begin
  create type dose_status as enum ('pending', 'taken', 'skipped', 'missed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app_role as enum ('patient', 'caregiver');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Identity helpers, read by the RLS policies
-- ---------------------------------------------------------------------

create schema if not exists app;

-- The patient this transaction is acting as. NULL when unset, which makes
-- every policy below fail closed.
create or replace function app.current_patient() returns uuid
  language sql stable as $fn$
  select nullif(current_setting('app.current_patient', true), '')::uuid
$fn$;

-- 'patient' (full access to own record) or 'caregiver' (read, plus dose
-- check-off). Defaults to the more restricted role.
create or replace function app.current_role() returns app_role
  language sql stable as $fn$
  select coalesce(
    nullif(current_setting('app.current_role', true), '')::app_role,
    'caregiver'::app_role
  )
$fn$;

-- ---------------------------------------------------------------------
-- Schedule clock
-- ---------------------------------------------------------------------
--
-- Patients are in India, but the server and database run on UTC. Every
-- "today" and "is this overdue" question goes through these functions so
-- there is exactly one place that knows the timezone and the slot times.
-- Keep SLOT_TIMES in lib/schema.ts in step with app.slot_time().

create or replace function app.today() returns date
  language sql stable as $fn$
  select (now() at time zone 'Asia/Kolkata')::date
$fn$;

-- Morning 8 AM, afternoon 1 PM, night 9 PM.
create or replace function app.slot_time(p_slot text) returns time
  language sql immutable as $fn$
  select case p_slot
    when 'morning'   then time '08:00'
    when 'afternoon' then time '13:00'
    when 'night'     then time '21:00'
  end
$fn$;

-- The moment a dose is due, as an absolute timestamp.
create or replace function app.dose_due_at(p_date date, p_slot text)
  returns timestamptz
  language sql immutable as $fn$
  select (p_date + app.slot_time(p_slot)) at time zone 'Asia/Kolkata'
$fn$;

-- ---------------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------------

create table if not exists patients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) between 1 and 80),
  language        patient_language not null default 'en',
  caregiver_name  text,
  caregiver_phone text check (caregiver_phone is null or caregiver_phone ~ '^[0-9+][0-9 ()-]{6,19}$'),

  -- Shared with family so they can follow along without an account.
  -- Alphabet excludes 0/O/1/I to stay readable out loud.
  share_code      char(6) not null unique check (share_code ~ '^[2-9A-HJ-NP-Z]{6}$'),

  -- Set on the login screen, after onboarding. NULL means "not yet
  -- registered". scrypt hash, never a plaintext password.
  password_hash   text,

  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- medicines
-- ---------------------------------------------------------------------

create table if not exists medicines (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references patients (id) on delete cascade,
  name             text not null check (length(btrim(name)) between 1 and 120),
  dosage           text not null,

  -- Slot keys such as {morning,afternoon,night}. A CHECK constraint cannot
  -- contain a subquery, so duplicates are deduped by medicineInput in
  -- lib/schema.ts; duplicate *doses* are impossible regardless, thanks to
  -- dose_logs_unique_slot below.
  time_slots       text[] not null check (cardinality(time_slots) > 0),

  food_instruction food_instruction not null default 'anytime',

  -- NULL means ongoing, with no end date.
  duration_days    integer check (duration_days is null or duration_days > 0),

  created_at       timestamptz not null default now()
);

create index if not exists medicines_patient_idx on medicines (patient_id);

-- ---------------------------------------------------------------------
-- dose_logs
-- ---------------------------------------------------------------------

create table if not exists dose_logs (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients (id) on delete cascade,
  medicine_id   uuid not null references medicines (id) on delete cascade,
  schedule_date date not null,
  slot          text not null,
  status        dose_status not null default 'pending',
  taken_at      timestamptz,

  -- One row per medicine, per day, per slot.
  constraint dose_logs_unique_slot unique (medicine_id, schedule_date, slot),

  -- taken_at is set exactly when the dose was taken.
  constraint dose_logs_taken_at_matches_status
    check ((status = 'taken') = (taken_at is not null))
);

create index if not exists dose_logs_patient_date_idx
  on dose_logs (patient_id, schedule_date);

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------

alter table patients  enable row level security;
alter table medicines enable row level security;
alter table dose_logs enable row level security;

-- force, so a table owner is held to the policies too.
alter table patients  force row level security;
alter table medicines force row level security;
alter table dose_logs force row level security;

drop policy if exists patients_select on patients;
create policy patients_select on patients
  for select using (id = app.current_patient());

-- Only the patient role may edit the profile; caregivers are read-only here.
drop policy if exists patients_update on patients;
create policy patients_update on patients
  for update using (id = app.current_patient() and app.current_role() = 'patient')
  with check (id = app.current_patient());

drop policy if exists medicines_select on medicines;
create policy medicines_select on medicines
  for select using (patient_id = app.current_patient());

drop policy if exists medicines_write on medicines;
create policy medicines_write on medicines
  for all using (patient_id = app.current_patient() and app.current_role() = 'patient')
  with check (patient_id = app.current_patient() and app.current_role() = 'patient');

drop policy if exists dose_logs_select on dose_logs;
create policy dose_logs_select on dose_logs
  for select using (patient_id = app.current_patient());

-- Both roles may check a dose off: that is the point of the Family tab.
drop policy if exists dose_logs_write on dose_logs;
create policy dose_logs_write on dose_logs
  for all using (patient_id = app.current_patient())
  with check (patient_id = app.current_patient());

-- ---------------------------------------------------------------------
-- Pre-identity paths
-- ---------------------------------------------------------------------
--
-- Onboarding, login and share-code join all have to touch a row *before*
-- any identity exists. Rather than punching a hole in the policies, each
-- runs through a security-definer function with a narrow return value.

create or replace function app.create_patient(
  p_name            text,
  p_language        patient_language,
  p_caregiver_name  text,
  p_caregiver_phone text,
  p_share_code      char(6)
) returns patients
  language sql security definer set search_path = public, app as $fn$
  insert into patients (name, language, caregiver_name, caregiver_phone, share_code)
  values (btrim(p_name), p_language, nullif(btrim(p_caregiver_name), ''),
          nullif(btrim(p_caregiver_phone), ''), p_share_code)
  returning *
$fn$;

-- Returns only what the login screen needs, so it cannot be used to read
-- a patient's medical data without an identity.
create or replace function app.auth_lookup(p_id uuid)
  returns table (id uuid, password_hash text)
  language sql security definer set search_path = public, app as $fn$
  select p.id, p.password_hash from patients p where p.id = p_id
$fn$;

-- The UI language at sign-in, before an identity exists. Returns nothing
-- but the language code.
create or replace function app.auth_language(p_id uuid)
  returns table (language patient_language)
  language sql security definer set search_path = public, app as $fn$
  select p.language from patients p where p.id = p_id
$fn$;

-- Registration only ever fills an empty slot: it can never overwrite an
-- existing password.
create or replace function app.set_password(p_id uuid, p_hash text)
  returns boolean
  language sql security definer set search_path = public, app as $fn$
  update patients set password_hash = p_hash
   where id = p_id and password_hash is null
  returning true
$fn$;

create or replace function app.resolve_share_code(p_code char(6))
  returns uuid
  language sql security definer set search_path = public, app as $fn$
  select id from patients where share_code = upper(p_code)
$fn$;

-- ---------------------------------------------------------------------
-- Application role — run once, then point DATABASE_URL at app_user
-- ---------------------------------------------------------------------
--
--   create role app_user with login password '<a-strong-password>' noinherit;
--   grant usage on schema public, app to app_user;
--   grant select, insert, update, delete on patients, medicines, dose_logs to app_user;
--   grant execute on function app.current_patient, app.current_role,
--     app.create_patient, app.auth_lookup, app.auth_language, app.set_password,
--     app.resolve_share_code to app_user;
--
-- Deliberately NOT granted: create/drop, and any blanket schema-wide
-- execute. app_user can only do what the policies above allow.
