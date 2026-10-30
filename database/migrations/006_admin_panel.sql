ALTER TABLE public.bookings
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN cancellation_reason varchar(500);

CREATE TABLE public.admin_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id bigint REFERENCES public.users(id) ON DELETE SET NULL,
  actor_email varchar(255) NOT NULL,
  action varchar(40) NOT NULL,
  resource_type varchar(20) NOT NULL CHECK (resource_type IN ('user','room','booking')),
  resource_id bigint NOT NULL,
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created_idx ON public.admin_audit_log(created_at DESC, id DESC);
