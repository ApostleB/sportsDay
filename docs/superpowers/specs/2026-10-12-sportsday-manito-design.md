# 명량운동회 플랫폼: 3단계(마니또) 설계

- 작성일: 2026-10-12
- 상태: 사용자 검토 대기
- 선행: 1단계 `2026-10-11-sportsday-foundation-design.md`, 2단계 `2026-10-12-sportsday-team-draw-design.md`. 이 문서에 없는 규칙(인증, 세션, 에러 처리, 디자인 시스템, 관리 화면 레이아웃)은 앞 단계 스펙과 현재 코드를 따른다

## 0. 목표와 확정된 요구사항

운동회 참가자 전원을 하나의 순환으로 묶어 마니또를 정하고, 각자 자기 마니또만 확인하다가 생성자가 전체를 공개한다.

사용자가 확정한 내용:

- 배정은 **하나의 순환**(A→B→C→…→A)이다. 빠지는 사람이 없다
- 각자 **자기 마니또만** 본다. 홈의 봉투를 누르면 펼쳐지고 다시 접을 수 있다
- **전체 공개는 생성자**가 연다. 공개 전에는 생성자도 배정을 볼 수 없다
- **플랫폼 관리자는 잠금**으로 공개된 전체 맵만 숨겼다 다시 보이게 할 수 있다. 개인 확인은 잠금과 무관하게 계속된다
- 관리자 화면의 마니또 정보는 **이름을 마스킹**한다(`mask.js`: `홍*동`, `남**원`)
- 결석·추가·삭제는 **자동으로 최소 수정** 반영한다
- 생성자와 관리자는 **참가 마감**으로 새 참가자가 입장하는 것을 막을 수 있다
- 폴링 없음. 화면은 접속·새로고침 시점의 상태를 보여 준다

## 1. 상태와 흐름

`events.manito_stage`:

| 값 | 의미 | 가능한 일 |
|---|---|---|
| `none` | 배정 전 | 생성자 배정 |
| `assigned` | 배정됨, 비공개 | 개인 확인, 다시 배정, 공개, 자동 반영 |
| `opened` | 전체 공개 | 개인 확인, 맵 보기(잠금 해제 시), 관리자 잠금, 자동 반영 |

1. **배정(생성자)**: 그 시점의 출석 참가자 전원을 무작위로 섞어 순환을 만든다. 출석 인원이 3명 미만이면 거부한다. `manito_stage='assigned'`
2. **개인 확인(참가자)**: 봉투를 처음 열 때 `acknowledged_at`을 기록한다
3. **다시 배정(생성자, `assigned`에서만)**: 확인 문구 `다시 배정`(앞뒤 공백 무시)을 입력하면 출석 인원으로 순환 전체를 새로 만든다. 모든 `acknowledged_at`이 비워진다
4. **공개(생성자, `assigned`에서만)**: `manito_stage='opened'`. 되돌리기는 없다
5. **잠금(관리자, 언제든)**: `manito_locked` 토글. `opened`이면서 잠기지 않았을 때만 맵이 보인다

## 2. 자동 반영(최소 수정)

순환에 들어 있는지는 `manito_links`의 `giver_id`로 판단한다. `manito_stage`가 `none`이면 자동 반영하지 않는다.

- **빠짐**: 순환에 있는 참가자가 결석으로 바뀌거나 삭제되면, A→X→B를 A→B로 잇는다. 마니또가 바뀐 A의 `acknowledged_at`을 비운다
- **합류**: 순환에 없는 참가자가 출석으로 바뀌거나, 출석 상태로 새로 생기면(입장 또는 생성자 직접 추가), 순환의 무작위 연결 A→B를 골라 A→새 사람→B로 만든다. A의 `acknowledged_at`을 비우고, 새 사람의 링크는 확인 전 상태로 만든다
- **작은 순환**: 빠짐 결과 순환이 2명이 되면 A↔B 두 사람이 서로의 마니또가 된다. 1명이 되면 순환을 비우고(자기 자신 금지) 그 사람은 마니또가 없는 상태가 된다. 생성자 화면에 "순환 인원이 3명보다 적습니다" 경고를 보인다. 순환이 비어 있는 상태(`manito_links` 0행, 단계는 `assigned`/`opened` 유지)에서 합류가 생기면, 이전에 빠졌던 사람을 포함해 출석자가 2명 이상 모일 때 그들로 새 순환을 만든다
- 공개(`opened`) 후에도 같은 규칙으로 반영하고, 맵은 현재 순환을 보여 준다
- 자동 반영은 변동을 일으킨 쓰기(출석 변경, 참가자 삭제, 참가자 생성)와 **같은 트랜잭션**에서, 운동회 행을 잠근 뒤 실행한다

## 3. 참가 마감

- 새 컬럼 `events.join_closed boolean`. 켜져 있으면 입장 화면에서 **처음 보는 이름**으로는 입장할 수 없다(`참가가 마감되었습니다`). 이미 등록된 사람의 재입장은 그대로 된다
- 생성자 대시보드와 관리자 운동회 상세에서 켜고 끈다
- 생성자가 참가자 관리에서 직접 추가하는 것은 마감 중에도 허용한다
- 기존 `status='closed'`(종료) 규칙은 그대로 둔다

## 4. 데이터

1단계에서 만든 것: `events.manito_stage`, `events.manito_locked`, `manito_links(event_id, giver_id, receiver_id, updated_at, acknowledged_at)`와 `unique(event_id, giver_id)`, `unique(event_id, receiver_id)`, `check(giver_id <> receiver_id)`.

마이그레이션 `004_manito.sql`:

```sql
ALTER TABLE events ADD COLUMN join_closed boolean NOT NULL DEFAULT false;
-- 순환을 이어 붙이는 도중의 일시적 중복을 허용하고 트랜잭션 끝에 검사한다
ALTER TABLE manito_links DROP CONSTRAINT manito_links_event_id_giver_id_key;
ALTER TABLE manito_links DROP CONSTRAINT manito_links_event_id_receiver_id_key;
ALTER TABLE manito_links ADD CONSTRAINT manito_links_giver_unique UNIQUE (event_id, giver_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE manito_links ADD CONSTRAINT manito_links_receiver_unique UNIQUE (event_id, receiver_id) DEFERRABLE INITIALLY DEFERRED;
```

(기존 제약 이름 `manito_links_event_id_giver_id_key`, `manito_links_event_id_receiver_id_key`는 개발·운영 DB에서 확인했다.)

불변식: `manito_stage`가 `none`이 아니고 순환 인원이 2명 이상이면, `manito_links`의 giver 집합과 receiver 집합은 같고 하나의 고리를 이룬다. 순환 인원은 2명 이상이거나 0명이다.

## 5. 화면

### 참가자 (`/e/:slug/...`)

- **홈 "💌 내 마니또" 카드**
  - `none`: "마니또 준비 중"
  - 순환에 있고 `acknowledged_at`이 비어 있음: "봉투가 도착했어요" + `열어 보기`(→ `/manito`)
  - 순환에 있고 확인함: `내 마니또 보기`(→ `/manito`)
  - 순환에 없음(결석 등): "지금은 마니또가 없어요"
  - `opened`이고 잠기지 않음: `마니또 맵 보기`(→ `/manito/map`) 추가
- **`GET /manito`**: 확인 전이면 봉투와 `봉투 열기` 버튼(`POST /manito/open`, 확인 시각 기록 후 `/manito`로 303). 확인 후에는 접힌 봉투(`<details>`)를 눌러 이름을 펼친다(서버 요청 없음, 자바스크립트 없이 동작)
- **`GET /manito/map`**: `opened`이고 잠기지 않았을 때만 순환을 보여 준다. 그 외에는 "아직 공개되지 않았어요". 휴대폰은 세로 연결 목록(`A → B`, 마지막은 처음으로), 넓은 화면(768px 이상)은 원형 배치(이름을 원 둘레에 순서대로, 방향 표시)

### 생성자 (`/e/:slug/manage/manito`, 관리 메뉴에 "마니또" 추가)

- 상태(준비 / 배정됨 / 공개됨), 현재 순환 인원, "N명 확인함", 출석 인원
- `none`: `마니또 배정`
- `assigned`: `마니또 공개`, `다시 배정`(확인 문구)
- `opened`: 공개됨 안내와 맵 링크(잠겨 있으면 "관리자가 맵을 잠갔습니다")
- 순환 인원 3명 미만 경고
- **공개 전에는 짝 정보를 어떤 형태로도 렌더링하지 않는다**
- 대시보드: `참가 마감` 켜기/끄기 버튼과 현재 상태

### 플랫폼 관리자 (`/admin/events/:id`)

- "마니또" 칸: 상태, 확인 인원, `맵 잠그기`/`잠금 해제`, 마스킹된 순환(`홍*동 → 남**원`, 공개 여부와 무관하게 항상 마스킹)
- "참가 마감" 켜기/끄기

## 6. 서비스 구성

- `src/services/manito-cycle.js`: 순수 함수. `buildCycle(ids, random)`, `removeFromCycle(links, id)`, `insertIntoCycle(links, id, random)`. `links`는 `[{ giver, receiver }]`
- `src/services/manito.js`: 배정, 다시 배정, 공개, 잠금, 개인 조회·확인, 맵 조회, 관리자 마스킹 조회, 생성자 요약, `syncPresence(client, eventId, participantId)`(자동 반영 진입점)
- `participants.js`: `setAttendance`, `deleteParticipant`, `createParticipant`, `join`(새 참가자 생성 경로)에서 같은 트랜잭션으로 `syncPresence` 호출. `join`의 신규 생성은 운동회 잠금과 `join_closed` 검사를 포함한 트랜잭션으로 바꾼다
- `events.js`: `setJoinClosed(id, value)`
- 모든 서비스는 앞 단계 규칙(id 검증, `event_id` 범위, `ValidationError`)을 따른다

## 7. 동시성과 비공개 보장

- 배정, 다시 배정, 공개, 잠금, 참가 마감 변경, 개인 확인 기록, 자동 반영은 모두 `tx` 안에서 `lockEvent`로 운동회 행을 먼저 잠근다
- 개인 조회는 자기 `giver_id` 행만 읽는다
- 맵 조회는 `opened && !manito_locked`일 때만 짝을 반환한다
- 생성자 요약은 인원·확인 수 같은 집계만 반환하고 짝을 반환하지 않는다
- 관리자 조회는 서비스에서 이미 마스킹한 이름만 반환한다(뷰에서 마스킹하지 않음)

## 8. 에러 처리

- 단계에 맞지 않는 요청(공개 전 맵, 배정 전 공개 등): 생성자 POST는 같은 화면 400과 메시지, 참가자 맵은 안내 문구
- 출석 3명 미만 배정, 확인 문구 불일치: 400과 메시지
- 마감 중 새 이름 입장: 입장 폼 400 `참가가 마감되었습니다`

## 9. 테스트

- `manito-cycle` 단위 테스트(시드 고정): 다양한 인원(3~40)에서 `buildCycle`이 한 고리·자기 자신 없음·모두 한 번; `removeFromCycle`/`insertIntoCycle`을 무작위로 수백 번 섞어 적용해도 항상 한 고리이고 바뀐 giver가 최대 1명; 2명·1명·0명 경계
- 서비스·라우트 통합 테스트:
  - 배정 거부(3명 미만), 배정 후 모든 출석자가 한 고리
  - 개인 조회는 자기 것만, 확인 시각 기록, 다른 참가자 화면에 남의 짝이 안 나옴
  - 공개 전 생성자 화면 HTML에 어떤 짝도 없음(참가자 이름 쌍 검사)
  - 공개 후 맵, 잠금 시 맵 숨김·개인 확인은 유지, 잠금 해제
  - 자동 반영: 결석·삭제·출석 복귀·새 입장·생성자 직접 추가 각각 후 한 고리 유지, 바뀐 사람의 확인 초기화
  - 동시 변동(`Promise.all`로 출석 변경 여러 건) 후에도 한 고리
  - 다시 배정(확인 문구), 공개 후 다시 배정 거부
  - 참가 마감: 새 이름 거부, 기존 이름 재입장 허용, 생성자 직접 추가 허용
  - 관리자 화면은 마스킹된 이름만 보이고 원래 이름은 HTML에 없음
  - 일반 참가자는 생성자·관리자 기능 접근 불가

## 10. 범위 밖(3단계)

- 마니또 미션, 쪽지, 선물 기록
- 같은 팀끼리 피하기 같은 배정 조건
- 공개 연출 애니메이션(맵은 정적 화면)
