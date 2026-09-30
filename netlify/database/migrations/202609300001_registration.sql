-- Registration only. Match scores, draws and courts remain in browser storage.
create table tournaments (
  id text primary key,
  name text not null,
  event_date date,
  venue text not null default '',
  published boolean not null default true,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table events (
  id text primary key,
  tournament_id text not null references tournaments(id),
  name text not null,
  event_type text not null check(event_type in ('singles','doubles')),
  format text not null default 'groups2',
  capacity integer not null check(capacity between 1 and 1000),
  registration_enabled boolean not null default false,
  registration_close date,
  allow_partner_needed boolean not null default true,
  auto_waitlist boolean not null default true,
  updated_at timestamptz not null default now()
);
create table players (
  id uuid primary key,
  tournament_id text not null references tournaments(id),
  name text not null check(length(name) between 1 and 100),
  email text not null check(length(email) between 3 and 160),
  phone text not null check(length(phone) between 1 and 40),
  unique(tournament_id,email)
);
create table teams (
  id uuid primary key,
  tournament_id text not null references tournaments(id),
  name text not null check(length(name) between 1 and 220)
);
create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  player_id uuid not null references players(id),
  position integer not null check(position in (1,2)),
  primary key(team_id,position),
  unique(team_id,player_id)
);
create table event_entries (
  id text primary key,
  event_id text not null references events(id),
  player_id uuid references players(id),
  team_id uuid references teams(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((player_id is null) <> (team_id is null)),
  unique(event_id,player_id),
  unique(event_id,team_id)
);
create table registrations (
  id uuid primary key,
  request_key uuid not null unique,
  tournament_id text not null references tournaments(id),
  event_id text not null references events(id),
  player_id uuid not null references players(id),
  partner_id uuid references players(id),
  team_id uuid references teams(id),
  entry_id text references event_entries(id),
  needs_partner boolean not null default false,
  status text not null check(status in ('pending','confirmed','waitlisted','needs_partner','rejected','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (partner_id is null or partner_id <> player_id)
);
create index registrations_event_status_idx on registrations(event_id,status);
create index registrations_tournament_date_idx on registrations(tournament_id,created_at desc);
create index entries_active_idx on event_entries(event_id) where active;
-- Nobody connects directly from the browser. Only Functions use database credentials.
revoke all on tournaments,events,players,teams,team_members,registrations,event_entries from public;
