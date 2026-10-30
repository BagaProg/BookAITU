-- Existing pending bookings already reserve their intervals. Preserve them as confirmed.
UPDATE public.bookings SET status = 'confirmed' WHERE status = 'pending';
ALTER TABLE public.bookings ALTER COLUMN status SET DEFAULT 'confirmed';
ALTER TABLE public.bookings ADD CONSTRAINT bookings_final_status_check
  CHECK (status IN ('confirmed', 'cancelled'));
