BEGIN;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_final_status_check;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_final_status_check CHECK (status IN ('pending','confirmed','cancelled','rejected','expired'));
ALTER TABLE public.bookings ALTER COLUMN status SET DEFAULT 'pending';
CREATE INDEX IF NOT EXISTS bookings_pending_user_idx ON public.bookings(user_id,booking_date) WHERE status='pending';
COMMIT;
