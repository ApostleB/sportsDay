-- PIN이 재설정되면 기존 세션을 무효화하기 위한 버전 번호
ALTER TABLE participants ADD COLUMN pin_version int NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN creator_pin_version int NOT NULL DEFAULT 0;
