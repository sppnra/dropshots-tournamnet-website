-- Additive upgrade: existing confirmations remain free; no retrospective charges.
alter table events add column entry_fee numeric(10,2) not null default 0 check(entry_fee >= 0);
alter table events add column payment_required boolean not null default false;
create table tournament_payment_settings (
  tournament_id text primary key references tournaments(id),
  bank_account_name text not null default '', bank_name text not null default '',
  sort_code text not null default '', account_number text not null default '',
  payment_reference_prefix text not null default 'DF', payment_instructions text not null default '',
  revision integer not null default 1, updated_at timestamptz not null default now()
);
-- One charge per active roster entry, including a pair of needs-partner registrations.
create table registration_payments (
  id uuid primary key, entry_id text not null unique references event_entries(id),
  tournament_id text not null references tournaments(id), event_id text not null references events(id),
  payment_status text not null check(payment_status in ('not_required','pending','paid')),
  payment_reference text unique, payment_amount numeric(10,2) not null check(payment_amount >= 0),
  approved_at timestamptz not null default now(), approval_email_sent_at timestamptz,
  payment_received_at timestamptz, payment_received_by text, payment_email_sent_at timestamptz
);
create table payment_email_outbox (
  id uuid primary key, payment_id uuid not null references registration_payments(id),
  kind text not null check(kind in ('approval','payment')), recipient text not null,
  payload jsonb not null, status text not null default 'queued' check(status in ('queued','sending','sent','failed','uncertain')),
  attempt_started_at timestamptz, idempotency_started_at timestamptz, sent_at timestamptz,
  attempts integer not null default 0, last_error text, provider_message_id text,
  unique(payment_id,kind,recipient)
);
create table payment_audit (
  id uuid primary key, payment_id uuid not null references registration_payments(id),
  action text not null, actor text not null, created_at timestamptz not null default now()
);
create index registration_payments_tournament on registration_payments(tournament_id);
revoke all on tournament_payment_settings,registration_payments,payment_email_outbox,payment_audit from public;
