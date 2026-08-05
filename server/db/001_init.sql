-- Solaris Wallpaper schema.
-- Applied by server/db/migrate.ts. Every statement must be idempotent-safe
-- within its own migration file; this is migration 001.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ users

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  -- Google's OIDC subject. Match on this, NEVER on email: emails change hands.
  google_sub    text unique not null,
  email         text not null,
  name          text,
  picture_url   text,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- ----------------------------------------------------------------- boards

create table if not exists boards (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references users(id) on delete cascade,
  slug                text not null default 'main',
  -- 32 random bytes, base64url. The capability that makes /b/<token> work
  -- without a cookie, because Plash cannot be relied on to keep one.
  public_token        text unique not null,
  token_rotated_at    timestamptz,
  rows                smallint not null default 6,
  cols                smallint not null default 22,
  config              jsonb not null default '{}'::jsonb,

  -- Runtime state that used to live in the in-memory BoardStateMachine.
  main_source         text,
  main_text           text not null default '',
  main_cells          jsonb,
  main_fetched_at     timestamptz,
  rotation_index      integer not null default 0,
  override_text       text,
  override_cells      jsonb,
  -- Replaces the 2-second setInterval tick: expiry is computed at read time.
  override_expires_at timestamptz,
  revision            bigint not null default 0,
  -- Advisory lease so concurrent polls don't all refresh the same board.
  fetch_lock_at       timestamptz,
  last_seen_at        timestamptz,
  created_at          timestamptz not null default now()
);

create unique index if not exists boards_user_slug_idx on boards (user_id, slug);

-- ---------------------------------------------------------- integrations

create table if not exists board_integrations (
  id                uuid primary key default gen_random_uuid(),
  board_id          uuid not null references boards(id) on delete cascade,
  kind              text not null check (kind in ('telegram', 'slack', 'discord')),
  enabled           boolean not null default false,
  -- AES-256-GCM of a JSON credential bag; AAD binds it to this row.
  secret_ciphertext bytea,
  secret_nonce      bytea,
  secret_tag        bytea,
  key_version       smallint not null default 1,
  -- 24 random bytes, base64url. Routes POST /hooks/<kind>/<path_id> to a board.
  webhook_path_id   text unique,
  external_id       text,
  channel_filter    text,
  status            text not null default 'unconfigured',
  status_detail     text,
  last_event_at     timestamptz,
  updated_at        timestamptz not null default now()
);

create unique index if not exists board_integrations_board_kind_idx
  on board_integrations (board_id, kind);

-- --------------------------------------------------------- idempotency

create table if not exists webhook_events (
  id                bigserial primary key,
  integration_id    uuid not null references board_integrations(id) on delete cascade,
  provider_event_id text not null,
  received_at       timestamptz not null default now()
);

create unique index if not exists webhook_events_dedupe_idx
  on webhook_events (integration_id, provider_event_id);

-- --------------------------------------------------------------- sessions

create table if not exists sessions (
  id           text primary key,
  user_id      uuid not null references users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  user_agent   text
);

create table if not exists oauth_states (
  state         text primary key,
  nonce         text not null,
  code_verifier text not null,
  return_to     text,
  expires_at    timestamptz not null
);

-- ---------------------------------------------------------------- support

create table if not exists support_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references users(id) on delete set null,
  kind           text not null check (kind in ('feature', 'complaint', 'other')),
  subject        text not null,
  body           text not null,
  reply_to       text,
  created_at     timestamptz not null default now(),
  delivered_at   timestamptz,
  delivery_error text
);

-- ------------------------------------------------------------ source cache

-- Cross-tenant dedupe of upstream calls. 100 boards on Hacker News become one
-- fetch per TTL, not 100.
create table if not exists source_cache (
  cache_key  text not null,
  rows       smallint not null,
  cols       smallint not null,
  text       text not null,
  cells      jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (cache_key, rows, cols)
);
