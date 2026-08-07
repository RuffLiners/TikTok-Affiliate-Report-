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
