-- Correct only the known 2026 preset; preserve customized capacities and all results.
update team_cups set data=jsonb_set(data,'{config,capacity}','18'),version=version+1
where tournament_id='t_team_cup_2026' and data->'config'->>'capacity'='12';
alter table team_cup_members drop constraint team_cup_members_position_check;
alter table team_cup_members add constraint team_cup_members_position_check check(position between 1 and 20);
create table team_cup_payments (
 id uuid primary key, team_id uuid not null unique references team_cup_teams(id),
 tournament_id text not null references team_cups(tournament_id),
 payment_status text not null check(payment_status in ('pending','paid','not_required')),
 payment_reference text unique, payment_amount numeric(10,2) not null check(payment_amount>=0),
 fee_per_person numeric(10,2) not null, team_size integer not null,
 approved_at timestamptz not null default now(), approval_email_sent_at timestamptz,
 payment_received_at timestamptz, payment_received_by text, payment_email_sent_at timestamptz
);
alter table payment_email_outbox alter column payment_id drop not null;
alter table payment_email_outbox add column cup_payment_id uuid references team_cup_payments(id);
alter table payment_email_outbox add constraint email_payment_owner check((payment_id is null)<>(cup_payment_id is null));
create unique index cup_email_recipient on payment_email_outbox(cup_payment_id,kind,recipient);
create index cup_payments_tournament on team_cup_payments(tournament_id);
revoke all on team_cup_payments from public;
