-- User-approved removal of non-bookable zones and room creation timestamps.
-- Refuse to cascade-delete any bookings if someone reserved a removed zone.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.bookings b JOIN public.rooms r ON r.id = b.room_id
    WHERE r.room_type NOT IN ('room', 'hall', 'open_space', 'coworking')
  ) THEN
    RAISE EXCEPTION 'A zone selected for removal has bookings; resolve them explicitly first';
  END IF;
END $$;

DELETE FROM public.rooms WHERE room_type NOT IN ('room', 'hall', 'open_space', 'coworking');
UPDATE public.rooms SET number = 'ATAMEKEN_SPACE', name = 'Atameken Space'
WHERE block = 'C1.2' AND number = 'COWORKING' AND room_type = 'coworking';

ALTER TABLE public.rooms
  DROP COLUMN created_at,
  ADD CONSTRAINT rooms_allowed_type_check CHECK (room_type IN ('room', 'hall', 'open_space', 'coworking'));
