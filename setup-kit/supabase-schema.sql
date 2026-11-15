-- ============================================================
-- TikTok Affiliate Dashboard — Supabase Schema
-- Run this entire file in the Supabase SQL Editor
-- ============================================================

-- 1. weekly_reports
-- Stores every saved report snapshot
create table if not exists weekly_reports (
  id uuid primary key default gen_random_uuid(),
  report_date text unique not null,
  label text,
  data_window text,
  d30 jsonb,
  weekly_charts jsonb,
  monthly_charts jsonb,
  tables jsonb,
  agents jsonb,
  analysis jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. app_config
-- Key-value store for goals, API keys, live report cache
create table if not exists app_config (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. report_jobs
-- Async job queue for report generation phases
create table if not exists report_jobs (
  id uuid primary key default gen_random_uuid(),
  status text default 'queued',
  job_type text,
  params jsonb,
  phase integer default 0,
  phase_label text default 'Queued — starting shortly',
  phase_data jsonb default '{}'::jsonb,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- Row Level Security — disable for service role access
-- (The app uses the service role key server-side, so RLS
--  does not need to be enabled for these tables.)
-- ============================================================
alter table weekly_reports disable row level security;
alter table app_config     disable row level security;
alter table report_jobs    disable row level security;

-- ============================================================
-- 4. Scorecard (run this block on an existing project)
-- ============================================================
-- Published scorecards. `raw` is what the sources returned (nulls kept); the
-- page rebuilds the scorecard from it so manual Seller Center entries show
-- immediately. `scorecard` and `audit` are the published output of that run.
create table if not exists scorecards (
  as_of date primary key,
  raw jsonb not null,
  scorecard jsonb not null,
  audit jsonb not null,
  published_by text,
  created_at timestamptz default now()
);

-- Hand-entered Seller Center values: the co-funded GMV line (no Euka source), history Euka
-- cannot reach, and month_check rows for the monthly spot-check. One live value per period and line; every change is also appended to scorecard_manual_log.
create table if not exists scorecard_manual (
  period_type text not null check (period_type in ('week','month','month_check')),
  period_key text not null,
  line text not null,
  value numeric not null check (value >= 0),
  source text not null default 'manual' check (source in ('manual','seller_center')),
  entered_by text,
  entered_at timestamptz default now(),
  primary key (period_type, period_key, line)
);

create table if not exists scorecard_manual_log (
  id bigserial primary key,
  at timestamptz default now(),
  by text,
  action text,
  period_type text,
  period_key text,
  line text,
  old_value numeric,
  new_value numeric
);

-- Daily snapshots of Euka lifetime counters (Target Collab invites, emails,
-- usage-rights creators). Euka has no dated source for these, so weekly values
-- are differences between snapshots. History starts at the first snapshot.
create table if not exists scorecard_snapshots (
  snap_date date not null,
  key text not null,
  value numeric not null,
  created_at timestamptz default now(),
  primary key (snap_date, key)
);

alter table scorecards            disable row level security;
alter table scorecard_manual      disable row level security;
alter table scorecard_manual_log  disable row level security;
alter table scorecard_snapshots   disable row level security;
