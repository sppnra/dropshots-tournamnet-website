-- Additive beta mode. Standard registration and local scoring are unchanged.
create table team_cups (
  tournament_id text primary key references tournaments(id),
  version integer not null default 0, data jsonb not null
);
create table team_cup_teams (
  id uuid primary key, tournament_id text not null references team_cups(tournament_id),
  name text not null, status text not null default 'pending'
    check(status in ('pending','confirmed','waitlisted','rejected','withdrawn')),
  request_key uuid not null unique, created_at timestamptz not null default now()
);
create unique index team_cup_team_name on team_cup_teams(tournament_id,lower(name)) where status not in ('rejected','withdrawn');
create table team_cup_members (
  id uuid primary key, team_id uuid not null references team_cup_teams(id),
  position integer not null check(position between 1 and 4), name text not null,
  email text not null, phone text not null, category text not null check(category in ('men','women')),
  shirt_size text not null, unique(team_id,position)
);
create table team_cup_matches (
  id uuid primary key, tournament_id text not null references team_cups(tournament_id),
  tie_id uuid not null, state jsonb not null
);
create table referee_tokens (
  token_hash text primary key, token_text text not null,
  match_id uuid not null references team_cup_matches(id) on delete cascade,
  active boolean not null default true, created_at timestamptz not null default now()
);
create unique index referee_active_match on referee_tokens(match_id) where active;
create table score_events (
  sequence bigint generated always as identity primary key,
  match_id uuid references team_cup_matches(id) on delete set null,
  tournament_id text not null references team_cups(tournament_id),
  action text not null, actor text not null, before_state jsonb,
  detail jsonb not null default '{}', created_at timestamptz not null default now(), undone_at timestamptz
);
create index team_cup_matches_tournament on team_cup_matches(tournament_id);
create index score_events_match on score_events(match_id,sequence desc);
create index team_cup_members_team on team_cup_members(team_id);
revoke all on team_cups,team_cup_teams,team_cup_members,team_cup_matches,referee_tokens,score_events from public;
