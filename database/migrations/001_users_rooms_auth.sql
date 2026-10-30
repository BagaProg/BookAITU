-- Preserve existing ids and bookings. Microsoft ids cannot be inferred for legacy users.
ALTER TABLE public.users ALTER COLUMN id TYPE bigint;
ALTER TABLE public.rooms ALTER COLUMN id TYPE bigint;
ALTER TABLE public.bookings ALTER COLUMN id TYPE bigint,
  ALTER COLUMN user_id TYPE bigint,
  ALTER COLUMN room_id TYPE bigint;
ALTER SEQUENCE public.bookings_id_seq AS bigint;

ALTER TABLE public.users ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY
  (SEQUENCE NAME public.users_identity_seq);
SELECT setval('public.users_identity_seq', COALESCE((SELECT max(id) FROM public.users), 0) + 1, false);
ALTER TABLE public.rooms ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.rooms ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY
  (SEQUENCE NAME public.rooms_identity_seq);
SELECT setval('public.rooms_identity_seq', COALESCE((SELECT max(id) FROM public.rooms), 0) + 1, false);

ALTER TABLE public.users
  ADD COLUMN microsoft_id varchar(255) UNIQUE,
  ADD COLUMN name varchar(100),
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN two_factor_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN two_factor_secret text,
  ADD COLUMN backup_codes jsonb,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_login_at timestamptz,
  ALTER COLUMN password_hash DROP NOT NULL,
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'Asia/Qyzylorda';
-- Display label only; Microsoft will supply the verified profile at account linking.
UPDATE public.users SET name = left(split_part(email, '@', 1), 100);
ALTER TABLE public.users ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.users ADD CONSTRAINT users_two_factor_secret_check
  CHECK (NOT two_factor_enabled OR (microsoft_id IS NOT NULL AND nullif(two_factor_secret, '') IS NOT NULL));
ALTER TABLE public.users ADD CONSTRAINT users_backup_codes_array_check
  CHECK (backup_codes IS NULL OR jsonb_typeof(backup_codes) = 'array');
COMMENT ON COLUMN public.users.microsoft_id IS 'Verified Microsoft identifier. NULL only until legacy account linking; never generate from email.';
COMMENT ON COLUMN public.users.two_factor_secret IS 'Application-encrypted TOTP secret, never return through profile APIs.';
COMMENT ON COLUMN public.users.backup_codes IS 'Array of one-way recovery-code hashes, never plaintext recovery codes.';

CREATE FUNCTION public.bookaitu_users_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.bookaitu_users_set_updated_at();

ALTER TABLE public.rooms
  DROP CONSTRAINT rooms_name_key,
  ALTER COLUMN name TYPE varchar(100),
  ALTER COLUMN name DROP NOT NULL,
  ALTER COLUMN building DROP NOT NULL,
  ALTER COLUMN capacity DROP NOT NULL,
  ADD COLUMN block varchar(4) CHECK (block IN ('C1.1', 'C1.2', 'C1.3')),
  ADD COLUMN floor smallint CHECK (floor BETWEEN 1 AND 3),
  ADD COLUMN number varchar(20),
  ADD COLUMN code varchar(30) GENERATED ALWAYS AS (block || '.' || number) STORED UNIQUE,
  ADD COLUMN room_type varchar(20) NOT NULL DEFAULT 'room',
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT rooms_block_number_key UNIQUE (block, number);
-- The old generic rooms have no reliable mapping to the supplied real campus codes.
-- Retain them for booking history; exclude them from new booking selection.
UPDATE public.rooms SET is_active = false WHERE block IS NULL;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_location_check CHECK (
  NOT is_active OR (block IS NOT NULL AND floor IS NOT NULL AND number IS NOT NULL)
);
COMMENT ON COLUMN public.rooms.building IS 'Legacy label retained for booking history; new rooms use block.';
CREATE INDEX bookings_room_date_active_idx ON public.bookings(room_id, booking_date, start_time, end_time)
  WHERE status <> 'cancelled';
CREATE INDEX bookings_user_id_idx ON public.bookings(user_id);
