CREATE TABLE IF NOT EXISTS notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type text NOT NULL CHECK (content_type IN ('text','audio','image','video')),
  title text,
  content text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_by uuid REFERENCES admins(id),
  updated_by uuid REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK ((content_type = 'text' AND length(trim(content)) > 0) OR content_type <> 'text')
);
CREATE TABLE IF NOT EXISTS notice_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), notice_id uuid NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  media_type text NOT NULL CHECK (media_type IN ('audio','image','video','thumbnail')),
  cloudinary_public_id text NOT NULL, cloudinary_url text, secure_url text NOT NULL,
  resource_type text, format text, width integer, height integer, duration numeric, file_size bigint,
  thumbnail_url text, caption text, display_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notices_public_idx ON notices (status, published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS notices_created_idx ON notices (created_at DESC);
CREATE INDEX IF NOT EXISTS notice_media_notice_order_idx ON notice_media (notice_id, display_order);
CREATE UNIQUE INDEX IF NOT EXISTS notice_media_public_id_idx ON notice_media (cloudinary_public_id);
CREATE OR REPLACE FUNCTION set_notices_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS notices_updated_at ON notices;
CREATE TRIGGER notices_updated_at BEFORE UPDATE ON notices FOR EACH ROW EXECUTE FUNCTION set_notices_updated_at();

-- Run manually in the external Neon database. This migration is intentionally not executed by the app.
