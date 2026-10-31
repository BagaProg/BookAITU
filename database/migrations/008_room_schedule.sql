ALTER TABLE rooms ADD COLUMN access_rules text NOT NULL DEFAULT '',
 ADD COLUMN student_access boolean NOT NULL DEFAULT true,
 ADD COLUMN details_updated_at timestamptz;
CREATE TABLE room_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 room_id bigint NOT NULL REFERENCES rooms(id),
 kind text NOT NULL CHECK (kind IN ('class','closure','coverage')),
 title varchar(200) NOT NULL,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX room_events_interval ON room_events(room_id,starts_at,ends_at);
COMMENT ON TABLE room_events IS 'coverage explicitly certifies complete timetable coverage for an interval, absence is unknown';

UPDATE rooms SET student_access=false,access_rules='Staff only (floor map)',details_updated_at=now() WHERE block='C1.2' AND floor=3;
