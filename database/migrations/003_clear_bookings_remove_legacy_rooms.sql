-- Explicitly requested cleanup: remove old bookings and generic Room 101..120.
-- Requires a verified backup and --allow-booking-cleanup in the migration runner.
DELETE FROM public.bookings;
DELETE FROM public.rooms WHERE block IS NULL AND number IS NULL AND NOT is_active;

ALTER TABLE public.rooms
  DROP COLUMN building,
  ALTER COLUMN block SET NOT NULL,
  ALTER COLUMN floor SET NOT NULL,
  ALTER COLUMN number SET NOT NULL,
  ALTER COLUMN code SET NOT NULL;

ALTER TABLE public.rooms ADD CONSTRAINT rooms_number_floor_check CHECK (
  CASE WHEN room_type = 'room'
    THEN number ~ '^[1-3][0-9]{2}[A-Z]?$' AND left(number, 1) = floor::text
    ELSE true
  END
);
COMMENT ON COLUMN public.rooms.block IS 'Campus C1 and block 1, 2 or 3: C1.1, C1.2, C1.3.';
COMMENT ON COLUMN public.rooms.number IS 'Room number including suffix, e.g. 232P; first digit is the floor. Named zones use symbolic numbers.';
