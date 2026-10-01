-- LOCAL DEV ONLY. Not applied on Supabase.
-- schema.sql references auth.users because that is what Supabase provides.
-- Locally we stub it so the real schema applies unmodified.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
