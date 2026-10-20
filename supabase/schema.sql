-- THRYFTLY on Supabase. Run once: Supabase dashboard → SQL Editor → paste → Run.

-- Everything the shop stores. coll = products | drops | orders | messages | subscribers | doc
-- ("doc" rows hold settings, pages and import bookkeeping). The server reads and writes it with the
-- secret key; row level security with no policies keeps the public anon key out entirely.
create table if not exists public.thryftly (
  coll text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (coll, id)
);
alter table public.thryftly enable row level security;

-- Product images and admin uploads. Public to read (they're on the website), only the server can write.
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do update set public = true;
