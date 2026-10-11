CREATE TABLE events (
  id bigserial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  round_no int NOT NULL CHECK (round_no > 0),
  event_date date,
  meet_info text NOT NULL DEFAULT '',
  auth_code text NOT NULL,
  creator_pin_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'live', 'closed')),
  manito_stage text NOT NULL DEFAULT 'none' CHECK (manito_stage IN ('none', 'assigned', 'opened')),
  manito_locked boolean NOT NULL DEFAULT false,
  draw_open boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE groups (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE teams (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL,
  leader_participant_id bigint,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE participants (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  pin_hash text NOT NULL,
  group_id bigint REFERENCES groups(id) ON DELETE SET NULL,
  team_id bigint REFERENCES teams(id) ON DELETE SET NULL,
  attendance text NOT NULL DEFAULT 'present' CHECK (attendance IN ('present', 'absent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name)
);

ALTER TABLE teams ADD CONSTRAINT teams_leader_fk
  FOREIGN KEY (leader_participant_id) REFERENCES participants(id) ON DELETE SET NULL;

CREATE TABLE draw_results (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id bigint NOT NULL UNIQUE REFERENCES participants(id) ON DELETE CASCADE,
  team_id bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  drawn_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE announcements (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schedule_images (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  caption text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE manito_links (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  giver_id bigint NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  receiver_id bigint NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  UNIQUE (event_id, giver_id),
  UNIQUE (event_id, receiver_id),
  CHECK (giver_id <> receiver_id)
);

CREATE TABLE polls (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title text NOT NULL,
  anonymous boolean NOT NULL DEFAULT true,
  max_choices int NOT NULL DEFAULT 1 CHECK (max_choices >= 1),
  allow_other boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'revealed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE poll_options (
  id bigserial PRIMARY KEY,
  poll_id bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE poll_voters (
  id bigserial PRIMARY KEY,
  poll_id bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  participant_id bigint NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  voted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, participant_id)
);

CREATE TABLE poll_answers (
  id bigserial PRIMARY KEY,
  poll_id bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id bigint REFERENCES poll_options(id) ON DELETE CASCADE,
  other_text text,
  participant_id bigint REFERENCES participants(id) ON DELETE CASCADE,
  CHECK (option_id IS NOT NULL OR other_text IS NOT NULL)
);

CREATE INDEX participants_event_idx ON participants (event_id);
CREATE INDEX announcements_event_idx ON announcements (event_id);
CREATE INDEX schedule_images_event_idx ON schedule_images (event_id);

-- connect-pg-simple 표준 스키마
CREATE TABLE "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX "IDX_session_expire" ON "session" ("expire");
