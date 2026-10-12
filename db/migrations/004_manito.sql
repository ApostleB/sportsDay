-- 참가 마감: 켜져 있으면 처음 보는 이름으로는 입장할 수 없다
ALTER TABLE events ADD COLUMN join_closed boolean NOT NULL DEFAULT false;

-- 순환을 이어 붙이는 도중의 일시적 중복을 허용하고 트랜잭션 끝에 검사한다
ALTER TABLE manito_links DROP CONSTRAINT manito_links_event_id_giver_id_key;
ALTER TABLE manito_links DROP CONSTRAINT manito_links_event_id_receiver_id_key;
ALTER TABLE manito_links ADD CONSTRAINT manito_links_giver_unique
  UNIQUE (event_id, giver_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE manito_links ADD CONSTRAINT manito_links_receiver_unique
  UNIQUE (event_id, receiver_id) DEFERRABLE INITIALLY DEFERRED;
