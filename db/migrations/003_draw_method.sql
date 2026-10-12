-- 공개 기록이 본인 뽑기·대리·수동·팀장 중 무엇으로 생겼는지
ALTER TABLE draw_results ADD COLUMN method text NOT NULL DEFAULT 'self'
  CHECK (method IN ('self', 'proxy', 'manual', 'leader'));
