-- ============================================================================
-- UAC-Live 3D — Migration initiale
-- PostgreSQL 17 + PostGIS 3.5
--
-- Cette migration est écrite en SQL explicite plutôt que générée aveuglément :
-- elle doit créer les extensions AVANT les colonnes géométriques, et les index
-- GIST/GIN après les tables. L'ordre est significatif.
--
-- Elle est idempotente : rejouable sur une base partiellement initialisée.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Enums applicatifs matérialisés en types PostgreSQL
-- (les CHECK restent la garde de dernier recours, voir schéma)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. faculties
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS faculties (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          varchar(24)  NOT NULL,
  name          varchar(180) NOT NULL,
  short_name    varchar(32),
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS faculties_code_uq ON faculties (code);

-- ---------------------------------------------------------------------------
-- 2. users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 varchar(254) NOT NULL,
  password_hash         text         NOT NULL,
  full_name             varchar(120) NOT NULL,
  matricule             varchar(32)  NOT NULL,
  faculty_id            uuid REFERENCES faculties (id) ON DELETE SET NULL,
  department            varchar(120),
  level                 varchar(8),
  role                  varchar(16)  NOT NULL DEFAULT 'STUDENT',
  avatar_seed           varchar(64)  NOT NULL DEFAULT 'default',
  bio                   text,
  karma                 integer      NOT NULL DEFAULT 0,
  is_verified           boolean      NOT NULL DEFAULT false,
  is_active             boolean      NOT NULL DEFAULT true,
  onboarding_completed  boolean      NOT NULL DEFAULT false,
  privacy_mode          varchar(20)  NOT NULL DEFAULT 'FRIENDS_PROMO',
  failed_login_count    integer      NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  deleted_at            timestamptz,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT users_role_valid CHECK (role IN ('STUDENT','CONTRIBUTOR','MODERATOR','ADMIN')),
  CONSTRAINT users_privacy_valid CHECK (privacy_mode IN ('PUBLIC','FRIENDS_PROMO','BLURRED_ZONE','GHOST')),
  CONSTRAINT users_karma_bounds CHECK (karma >= -10000 AND karma <= 100000)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_matricule_uq ON users (matricule);
CREATE INDEX IF NOT EXISTS users_faculty_idx ON users (faculty_id);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);
CREATE INDEX IF NOT EXISTS users_fullname_trgm_idx ON users USING gin (full_name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 3. refresh_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash           varchar(64)  NOT NULL,
  token_family_id      uuid         NOT NULL,
  expires_at           timestamptz  NOT NULL,
  revoked_at           timestamptz,
  revoked_reason       varchar(64),
  replaced_by_token_id uuid,
  user_agent           varchar(256),
  created_at           timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_hash_uq ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens (token_family_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_idx ON refresh_tokens (expires_at);

-- ---------------------------------------------------------------------------
-- 4. buildings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buildings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                varchar(24)  NOT NULL,
  name                varchar(180) NOT NULL,
  short_name          varchar(32),
  category            varchar(24)  NOT NULL,
  faculty_id          uuid REFERENCES faculties (id) ON DELETE SET NULL,
  description         text,
  floors              integer      NOT NULL DEFAULT 1,
  footprint           geometry(Polygon, 4326),
  entrance            geometry(Point, 4326),
  centroid            geometry(Point, 4326),
  footprint_area_m2   real,
  source              varchar(16)  NOT NULL DEFAULT 'STUDENT',
  verification_status varchar(16)  NOT NULL DEFAULT 'UNVERIFIED',
  last_verified_at    timestamptz,
  last_verified_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  verification_count  integer      NOT NULL DEFAULT 0,
  capacity            integer,
  is_accessible       boolean      NOT NULL DEFAULT false,
  is_open             boolean      NOT NULL DEFAULT true,
  opening_hours       varchar(64),
  created_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  deleted_at          timestamptz,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT buildings_floors_bounds CHECK (floors >= 1 AND floors <= 60),
  CONSTRAINT buildings_category_valid CHECK (category IN
    ('ACADEMIC','AMPHITHEATER','ADMINISTRATIVE','LIBRARY','RESTAURANT','RESIDENCE','SPORT','HEALTH','SERVICE','OTHER')),
  CONSTRAINT buildings_status_valid CHECK (verification_status IN
    ('UNVERIFIED','PENDING','VERIFIED','REJECTED','OUTDATED')),
  CONSTRAINT buildings_source_valid CHECK (source IN ('OSM','INSTITUTIONAL','STUDENT'))
);
CREATE UNIQUE INDEX IF NOT EXISTS buildings_code_uq ON buildings (code);
CREATE INDEX IF NOT EXISTS buildings_category_idx ON buildings (category);
CREATE INDEX IF NOT EXISTS buildings_faculty_idx ON buildings (faculty_id);
CREATE INDEX IF NOT EXISTS buildings_verification_idx ON buildings (verification_status);
CREATE INDEX IF NOT EXISTS buildings_footprint_gist ON buildings USING gist (footprint);
CREATE INDEX IF NOT EXISTS buildings_entrance_gist ON buildings USING gist (entrance);
CREATE INDEX IF NOT EXISTS buildings_centroid_gist ON buildings USING gist (centroid);
CREATE INDEX IF NOT EXISTS buildings_name_trgm_idx ON buildings USING gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 5. building_verifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS building_verifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid        NOT NULL REFERENCES buildings (id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  action      varchar(24) NOT NULL,
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT building_verifications_action_valid CHECK (action IN ('VERIFY','REJECT','REPORT_OUTDATED'))
);
CREATE INDEX IF NOT EXISTS building_verifications_building_idx ON building_verifications (building_id);
CREATE INDEX IF NOT EXISTS building_verifications_user_idx ON building_verifications (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS building_verifications_unique_vote
  ON building_verifications (building_id, user_id);

-- ---------------------------------------------------------------------------
-- 6. building_history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS building_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid        NOT NULL REFERENCES buildings (id) ON DELETE CASCADE,
  changed_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  change_type varchar(32) NOT NULL,
  diff        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS building_history_building_idx ON building_history (building_id, created_at);

-- ---------------------------------------------------------------------------
-- 7. rooms
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id  uuid         NOT NULL REFERENCES buildings (id) ON DELETE CASCADE,
  code         varchar(24)  NOT NULL,
  name         varchar(120) NOT NULL,
  capacity     integer      NOT NULL DEFAULT 0,
  floor        integer      NOT NULL DEFAULT 0,
  room_type    varchar(16)  NOT NULL DEFAULT 'CLASSROOM',
  is_accessible boolean     NOT NULL DEFAULT false,
  is_open      boolean      NOT NULL DEFAULT true,
  footprint    geometry(Polygon, 4326),
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT rooms_capacity_bounds CHECK (capacity >= 0 AND capacity <= 5000),
  CONSTRAINT rooms_type_valid CHECK (room_type IN ('AMPHI','CLASSROOM','LAB','OFFICE','LIBRARY','OTHER')),
  CONSTRAINT rooms_floor_bounds CHECK (floor >= -2 AND floor <= 60)
);
CREATE UNIQUE INDEX IF NOT EXISTS rooms_building_code_uq ON rooms (building_id, code);
CREATE INDEX IF NOT EXISTS rooms_building_idx ON rooms (building_id);
CREATE INDEX IF NOT EXISTS rooms_room_footprint_gist ON rooms USING gist (footprint);

-- ---------------------------------------------------------------------------
-- 8. walkways (graphe piéton)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS walkways (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            varchar(48) NOT NULL,
  path            geometry(LineString, 4326) NOT NULL,
  from_node_id    varchar(64),
  to_node_id      varchar(64),
  distance_meters real        NOT NULL,
  is_accessible   boolean     NOT NULL DEFAULT true,
  restrictions    text,
  surface         varchar(16) NOT NULL DEFAULT 'UNKNOWN',
  source          varchar(16) NOT NULL DEFAULT 'STUDENT',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT walkways_distance_positive CHECK (distance_meters > 0),
  CONSTRAINT walkways_surface_valid CHECK (surface IN ('PAVED','GRAVEL','DIRT','UNKNOWN'))
);
CREATE UNIQUE INDEX IF NOT EXISTS walkways_code_uq ON walkways (code);
CREATE INDEX IF NOT EXISTS walkways_path_gist ON walkways USING gist (path);

-- ---------------------------------------------------------------------------
-- 9. friends
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS friends (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  addressee_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       varchar(16) NOT NULL DEFAULT 'PENDING',
  responded_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friends_status_valid CHECK (status IN ('PENDING','ACCEPTED','DECLINED','BLOCKED')),
  CONSTRAINT friends_not_self CHECK (requester_id <> addressee_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS friends_pair_uq
  ON friends (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
CREATE INDEX IF NOT EXISTS friends_requester_idx ON friends (requester_id);
CREATE INDEX IF NOT EXISTS friends_addressee_idx ON friends (addressee_id);

-- ---------------------------------------------------------------------------
-- 10. user_presence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_presence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status            varchar(24) NOT NULL DEFAULT 'OFFLINE',
  location          geography(Point, 4326),
  accuracy_meters   integer,
  building_id       uuid REFERENCES buildings (id) ON DELETE SET NULL,
  privacy_mode      varchar(20) NOT NULL DEFAULT 'FRIENDS_PROMO',
  consent_given_at  timestamptz NOT NULL DEFAULT now(),
  share_expires_at  timestamptz NOT NULL,
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_presence_status_valid CHECK (status IN
    ('ON_CAMPUS','IN_BUILDING','IN_CLASS','STUDYING','BREAK','LEAVING','OFFLINE')),
  CONSTRAINT user_presence_privacy_valid CHECK (privacy_mode IN
    ('PUBLIC','FRIENDS_PROMO','BLURRED_ZONE','GHOST')),
  CONSTRAINT user_presence_retention CHECK (share_expires_at <= consent_given_at + interval '24 hours'),
  CONSTRAINT user_presence_accuracy_bounds CHECK (accuracy_meters IS NULL OR (accuracy_meters >= 0 AND accuracy_meters <= 5000))
);
CREATE UNIQUE INDEX IF NOT EXISTS user_presence_user_uq ON user_presence (user_id);
CREATE INDEX IF NOT EXISTS user_presence_location_gist ON user_presence USING gist (location);
CREATE INDEX IF NOT EXISTS user_presence_building_idx ON user_presence (building_id);
CREATE INDEX IF NOT EXISTS user_presence_expires_idx ON user_presence (share_expires_at);

-- ---------------------------------------------------------------------------
-- 11. reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         varchar(140) NOT NULL,
  body          text,
  category      varchar(24)  NOT NULL,
  status        varchar(16)  NOT NULL DEFAULT 'ACTIVE',
  severity      integer      NOT NULL DEFAULT 2,
  location      geometry(Point, 4326) NOT NULL,
  building_id   uuid REFERENCES buildings (id) ON DELETE SET NULL,
  author_id     uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  confirmations integer      NOT NULL DEFAULT 0,
  rejections    integer      NOT NULL DEFAULT 0,
  comment_count integer      NOT NULL DEFAULT 0,
  expires_at    timestamptz,
  resolved_at   timestamptz,
  operation_id  uuid,
  deleted_at    timestamptz,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT reports_severity_bounds CHECK (severity >= 1 AND severity <= 5),
  CONSTRAINT reports_status_valid CHECK (status IN ('ACTIVE','CONFIRMED','RESOLVED','EXPIRED','REJECTED')),
  CONSTRAINT reports_category_valid CHECK (category IN
    ('MAINTENANCE','SAFETY','CLEANLINESS','CROWD','ACCESSIBILITY','EVENT','LOST_ITEM','OTHER')),
  CONSTRAINT reports_counts_positive CHECK (confirmations >= 0 AND rejections >= 0)
);
CREATE INDEX IF NOT EXISTS reports_location_gist ON reports USING gist (location);
CREATE INDEX IF NOT EXISTS reports_building_idx ON reports (building_id);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status);
CREATE INDEX IF NOT EXISTS reports_category_idx ON reports (category);
CREATE INDEX IF NOT EXISTS reports_created_idx ON reports (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS reports_operation_uq ON reports (operation_id) WHERE operation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 12. report_votes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_votes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id  uuid        NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  vote       integer     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_votes_value CHECK (vote IN (-1, 1))
);
CREATE UNIQUE INDEX IF NOT EXISTS report_votes_unique ON report_votes (report_id, user_id);
CREATE INDEX IF NOT EXISTS report_votes_report_idx ON report_votes (report_id);

-- ---------------------------------------------------------------------------
-- 13. report_comments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id  uuid          NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  author_id  uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       varchar(1000) NOT NULL,
  created_at timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_comments_report_idx ON report_comments (report_id, created_at);

-- ---------------------------------------------------------------------------
-- 14. sos_alerts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sos_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid         NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  kind            varchar(16)  NOT NULL,
  status          varchar(16)  NOT NULL DEFAULT 'ACTIVE',
  location        geography(Point, 4326),
  building_id     uuid REFERENCES buildings (id) ON DELETE SET NULL,
  message         varchar(500),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES users (id) ON DELETE SET NULL,
  cancelled_at    timestamptz,
  resolved_at     timestamptz,
  operation_id    uuid,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT sos_alerts_kind_valid CHECK (kind IN ('MEDICAL','SECURITY','HARASSMENT','FIRE','OTHER')),
  CONSTRAINT sos_alerts_status_valid CHECK (status IN ('ACTIVE','ACKNOWLEDGED','CANCELLED','RESOLVED'))
);
CREATE INDEX IF NOT EXISTS sos_alerts_user_idx ON sos_alerts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sos_alerts_status_idx ON sos_alerts (status);
CREATE INDEX IF NOT EXISTS sos_alerts_location_gist ON sos_alerts USING gist (location);
CREATE UNIQUE INDEX IF NOT EXISTS sos_alerts_operation_uq ON sos_alerts (operation_id) WHERE operation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 15. trusted_contacts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trusted_contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name           varchar(120) NOT NULL,
  relationship   varchar(48),
  phone          varchar(32),
  email          varchar(254),
  notify_on_sos  boolean      NOT NULL DEFAULT true,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT trusted_contacts_has_channel CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS trusted_contacts_user_idx ON trusted_contacts (user_id);

-- ---------------------------------------------------------------------------
-- 16. notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        varchar(24)  NOT NULL,
  title       varchar(180) NOT NULL,
  body        text,
  read        boolean      NOT NULL DEFAULT false,
  read_at     timestamptz,
  action_url  varchar(256),
  entity_type varchar(32),
  entity_id   uuid,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT notifications_type_valid CHECK (type IN
    ('ALERT','FRIEND_REQUEST','FRIEND_ACCEPTED','REPORT','SOS','STUDY_GROUP','SYSTEM','KARMA'))
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (user_id, read);

-- ---------------------------------------------------------------------------
-- 17. karma_transactions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS karma_transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  delta       integer     NOT NULL,
  reason      varchar(48) NOT NULL,
  entity_type varchar(32),
  entity_id   uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT karma_delta_nonzero CHECK (delta <> 0),
  CONSTRAINT karma_delta_bounds CHECK (delta >= -500 AND delta <= 500)
);
CREATE INDEX IF NOT EXISTS karma_user_idx ON karma_transactions (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 18. contributions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contributions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type   varchar(16) NOT NULL,
  target_id     uuid        NOT NULL,
  author_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  payload       text        NOT NULL,
  status        varchar(16) NOT NULL DEFAULT 'PENDING',
  reviewer_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewer_note text,
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contributions_target_valid CHECK (target_type IN ('BUILDING','ROOM','WALKWAY')),
  CONSTRAINT contributions_status_valid CHECK (status IN ('PENDING','APPROVED','REJECTED'))
);
CREATE INDEX IF NOT EXISTS contributions_status_idx ON contributions (status);
CREATE INDEX IF NOT EXISTS contributions_target_idx ON contributions (target_type, target_id);
CREATE INDEX IF NOT EXISTS contributions_author_idx ON contributions (author_id);

-- ---------------------------------------------------------------------------
-- 19. audit_logs (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  action       varchar(64) NOT NULL,
  target_type  varchar(32),
  target_id    varchar(64),
  operation_id uuid,
  ip_hash      varchar(64),
  user_agent   varchar(256),
  metadata     text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_idempotency_uq
  ON audit_logs (actor_id, operation_id) WHERE operation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 20. study_groups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS study_groups (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             varchar(140) NOT NULL,
  subject          varchar(64)  NOT NULL,
  description      text,
  building_id      uuid REFERENCES buildings (id) ON DELETE SET NULL,
  room_id          uuid,
  capacity         integer      NOT NULL DEFAULT 8,
  scheduled_at     timestamptz,
  duration_minutes integer      NOT NULL DEFAULT 90,
  creator_id       uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  is_active        boolean      NOT NULL DEFAULT true,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT study_groups_capacity_bounds CHECK (capacity >= 2 AND capacity <= 100)
);
CREATE INDEX IF NOT EXISTS study_groups_subject_idx ON study_groups (subject);
CREATE INDEX IF NOT EXISTS study_groups_scheduled_idx ON study_groups (scheduled_at);

-- ---------------------------------------------------------------------------
-- 21. study_group_members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS study_group_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id  uuid        NOT NULL REFERENCES study_groups (id) ON DELETE CASCADE,
  user_id   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS study_group_members_unique ON study_group_members (group_id, user_id);
CREATE INDEX IF NOT EXISTS study_group_members_user_idx ON study_group_members (user_id);

-- ---------------------------------------------------------------------------
-- 22. Table de suivi des migrations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _migrations (
  id         varchar(120) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  checksum   varchar(64) NOT NULL
);

COMMIT;
