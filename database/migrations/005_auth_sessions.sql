CREATE TABLE public.auth_sessions (
  sid varchar PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX auth_sessions_expire_idx ON public.auth_sessions(expire);
ALTER TABLE public.users ADD COLUMN two_factor_last_step bigint;
ALTER TABLE public.users ADD COLUMN second_factor_failures integer NOT NULL DEFAULT 0
  CHECK (second_factor_failures >= 0);
ALTER TABLE public.users ADD COLUMN second_factor_locked_until timestamptz;
ALTER TABLE public.users ADD CONSTRAINT users_two_factor_last_step_check
  CHECK (two_factor_last_step IS NULL OR two_factor_last_step >= 0);
