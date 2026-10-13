-- 투표 조회용 인덱스. 테이블은 001_init.sql에서 만들었다
CREATE INDEX polls_event_idx ON polls (event_id);
CREATE INDEX poll_options_poll_idx ON poll_options (poll_id, sort_order);
CREATE INDEX poll_answers_poll_idx ON poll_answers (poll_id);
