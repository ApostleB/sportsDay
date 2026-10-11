# 명량운동회 플랫폼: 1단계(기반) 설계

- 작성일: 2026-10-11
- 상태: 사용자 검토 대기

## 0. 배경과 목표

지인들끼리 매년 여는 "제 n회 명량운동회"를 운영하기 위한 웹 플랫폼이다.
운동회를 매년 하나씩 생성하고, 인증코드로 참가자를 입장시켜 공지·시간표·팀 뽑기·마니또·투표를 한곳에서 진행한다.

사용자는 세 부류다.

| 역할 | 정의 | 접근 방법 |
|---|---|---|
| 플랫폼 관리자 | 플랫폼 전체를 통제하는 단일 운영자 | `/admin`에서 `.env`의 `ADMIN_PASSWORD` 입력 |
| 생성자 | 특정 운동회를 만든 사람 | 참가자로 입장한 뒤 그 운동회의 6자리 생성자 PIN 입력 |
| 참가자 | 운동회에 입장한 사람 | 이름 + 개인 4자리 PIN + 운동회 인증코드 |

별도 회원가입은 없다. 생성자 PIN은 참가자에게 노출되지 않는다.

### 단계 분할

전체 범위가 크므로 네 단계로 나누고, 단계마다 스펙 → 계획 → 구현을 반복한다.

1. **기반(이 문서)**: 프로젝트 설정, DB, 세 역할의 인증, 운동회 생성·입장, 참가자 관리, 공지, 시간표 이미지
2. **팀 뽑기**: 팀·그룹 설정, 그룹 내 뽑기, 연출 애니메이션
3. **마니또**: 순환 배정, 개인 확인, 변동 대응, 전체 오픈과 맵, 관리자 잠금
4. **투표**: 익명/비익명, 다중 선택, 기타 항목

2~4단계의 테이블도 이 문서에서 미리 정의해 마이그레이션 순서를 고정하지만, 그 기능의 로직과 화면은 각 단계 스펙에서 확정한다.

## 1. 기술 스택

- Node.js 24, CommonJS JavaScript(TypeScript 미사용)
- Express 5, EJS(`express-ejs-layouts`로 공통 레이아웃)
- PostgreSQL 17, 드라이버 `pg`
- 세션: `express-session` + `connect-pg-simple`(세션을 DB `session` 테이블에 저장)
- 해시: `bcrypt`
- 업로드: `multer`(디스크 저장, `src/public/uploads/`)
- 설정: `dotenv`
- 테스트: Node 내장 `node:test` + `supertest`, 별도 테스트 DB
- 개발 실행: `node --watch`
- 실시간 갱신 없음: 모든 화면은 접속하거나 새로고침할 때 최신 상태를 조회한다. 팀 뽑기 결과는 뽑기 요청의 응답으로 받고, 다른 사람의 결과와 마니또 오픈은 새로고침으로 확인한다

## 2. 디렉터리 구조

```
sportsDay/
  src/
    app.js                 Express 앱 조립(미들웨어, 라우터, 에러 핸들러). listen 하지 않음
    server.js              app을 불러와 listen
    config.js              환경변수 읽기와 검증
    db.js                  pg Pool, query 헬퍼, 트랜잭션 헬퍼
    middleware/
      auth.js              requireAdmin, requireParticipant, requireCreator
      locals.js            현재 사용자 정보를 res.locals에 주입
    routes/
      public.js            메인, 운동회 생성, 초대 링크 입장
      participant.js       참가자 홈, 공지, 시간표
      creator.js           생성자 인증, 참가자·공지·시간표 관리
      admin.js             관리자 로그인과 관리 기능
    services/
      events.js
      participants.js
      announcements.js
      schedules.js
      mask.js              이름 마스킹
      codes.js             slug, 인증코드 생성
    views/
      layout.ejs
      partials/
      public/  participant/  creator/  admin/
      error.ejs
    public/
      css/app.css
      uploads/             업로드 이미지(git 제외)
  db/
    migrations/001_init.sql
    migrate.js             번호순으로 미적용 마이그레이션 실행
  tests/
  .env.example
  package.json
```

라우터는 요청 파싱과 렌더링만 담당하고, DB 접근과 규칙은 `services/`에 둔다.

## 3. 환경변수

| 이름 | 설명 | 예 |
|---|---|---|
| `PORT` | 서버 포트 | `3000` |
| `DATABASE_URL` | 접속 문자열 | `postgres://sportsday:비밀번호@localhost:5432/sportsday` |
| `TEST_DATABASE_URL` | 테스트용 DB | `postgres://sportsday:비밀번호@localhost:5432/sportsday_test` |
| `SESSION_SECRET` | 세션 서명 키 | 임의의 긴 문자열 |
| `ADMIN_PASSWORD` | 관리자 비밀번호 | 운영자가 지정 |

필수 값이 비어 있으면 서버 시작 시 에러로 종료한다.

## 4. 데이터 모델

모든 테이블의 PK는 `bigserial id`, 시각은 `timestamptz`이다. 운동회가 삭제되면 하위 데이터는 `ON DELETE CASCADE`로 함께 삭제된다.

### 1단계에서 사용

**events**
- `slug text unique not null`: 초대 링크용 8자 랜덤 문자열(혼동 문자 제외 영숫자)
- `title text not null`: 기본값 "제 {round_no}회 명량운동회"
- `round_no int not null`
- `event_date date`, `meet_info text`: 집합 일시·장소 안내
- `auth_code text not null`: 6자리 영숫자 대문자, 생성 시 자동 생성하며 생성자가 변경 가능
- `creator_pin_hash text not null`
- `status text not null default 'ready'`: `ready | live | closed`
- `manito_stage text not null default 'none'`: `none | assigned | opened`
- `manito_locked boolean not null default false`
- `draw_open boolean not null default false`
- `created_at`

**participants**
- `event_id` FK
- `name text not null`, `unique(event_id, name)`
- `pin_hash text not null`
- `gender text`: `M | F | null`
- `size_grade smallint`, `ability_grade smallint`: 1~5, 생성자가 입력
- `group_id` FK nullable, `team_id` FK nullable
- `attendance text not null default 'present'`: `present | absent`
- `created_at`

**announcements**: `event_id`, `title`, `body`, `pinned boolean default false`, `created_at`, `updated_at`

**schedule_images**: `event_id`, `file_name`(서버 저장 파일명), `caption`, `sort_order`, `created_at`

**session**: connect-pg-simple 표준 스키마

### 2~4단계용(테이블만 생성)

- **groups**: `event_id`, `name`, `sort_order`
- **teams**: `event_id`, `name`, `color`, `leader_participant_id`, `sort_order`
- **draw_results**: `event_id`, `participant_id unique`, `team_id`, `drawn_at`
- **manito_links**: `event_id`, `giver_id`, `receiver_id`, `updated_at`, `acknowledged_at`. `unique(event_id, giver_id)`, `unique(event_id, receiver_id)`, `check(giver_id <> receiver_id)`
- **polls**: `event_id`, `title`, `anonymous boolean`, `max_choices int`, `allow_other boolean`, `status text`(`open | closed | revealed`), `created_at`
- **poll_options**: `poll_id`, `label`, `sort_order`
- **poll_voters**: `poll_id`, `participant_id`, `unique(poll_id, participant_id)`. 중복 투표 방지 전용
- **poll_answers**: `poll_id`, `option_id nullable`, `other_text nullable`, `participant_id nullable`(익명이면 NULL)

## 5. 인증과 세션

세션 객체 구조:

```js
req.session.admin = true                       // 관리자 로그인 시
req.session.events = {                         // 운동회별 입장 정보
  [eventId]: { participantId, isCreator }
}
```

한 브라우저가 여러 운동회에 동시에 입장할 수 있도록 운동회별로 저장한다.

- **requireParticipant**: URL의 slug로 운동회를 찾고, 세션에 그 운동회 입장 정보가 없으면 `/e/:slug`로 리다이렉트. 참가자가 DB에서 삭제되었으면 세션 항목을 지우고 리다이렉트
- **requireCreator**: `session.admin`이면 참가자 세션 없이 바로 통과한다. 그 외에는 requireParticipant 통과 후 `isCreator`가 아니면 `/e/:slug/manage/unlock`(생성자 PIN 입력 폼)으로 리다이렉트
- **requireAdmin**: `session.admin`이 아니면 `/admin/login`으로 리다이렉트
- 로그인·입장 성공 시 `req.session.regenerate`로 세션 고정 공격을 막는다
- 비밀번호·PIN 비교 실패는 같은 메시지("정보가 일치하지 않습니다")로 응답한다
- 관리자 로그인은 `crypto.timingSafeEqual`로 비교한다
- 쿠키: `httpOnly`, `sameSite=lax`, 운영 환경에서 `secure`. 만료 30일
- 상태를 바꾸는 요청은 모두 POST이고 `sameSite=lax` 쿠키에 의존해 CSRF를 막는다(지인용 서비스로서의 절충)

## 6. 화면과 흐름

### 공개
- `GET /`: 운동회 만들기 버튼, slug 또는 초대 링크로 들어오라는 안내
- `GET /events/new`, `POST /events`: 회차, 제목(기본값 자동), 일시, 집합 안내, 생성자 PIN(6자리 숫자, 확인 입력 포함), 생성자 본인의 이름과 개인 PIN을 받는다. 생성 시 생성자를 첫 참가자로 등록하고 `isCreator=true`로 세션에 넣은 뒤 완료 화면으로 이동
- 완료 화면: 초대 링크 `https://호스트/e/:slug?code=인증코드`와 복사 버튼, 생성자 PIN은 다시 볼 수 없다는 경고
- `GET /e/:slug`: 입장 폼(이름, 개인 PIN 4자리, 인증코드). `?code=`가 있으면 인증코드를 미리 채운다. 이미 입장한 세션이면 홈으로 리다이렉트
- `POST /e/:slug/join`:
  - 인증코드 불일치 → 폼에 에러
  - 같은 이름이 없으면 신규 등록
  - 같은 이름이 있으면 PIN 검증 후 재접속. 불일치면 "이미 사용 중인 이름이거나 PIN이 틀렸습니다"
  - `status=closed` 운동회는 신규 등록 불가, 기존 참가자 재접속만 허용

### 참가자 (`/e/:slug/...`)
- `GET /home`: 운동회 제목·일시·집합 안내, 고정 공지 우선 공지 목록, 시간표 이미지, 생성자이면 관리 페이지 버튼
- `GET /announcements/:id`: 공지 상세
- `POST /logout`: 이 운동회 세션 항목만 삭제

### 생성자 (`/e/:slug/manage/...`)
- `GET|POST /manage/unlock`: 6자리 PIN 입력
- `GET /manage`: 대시보드(참가자 수, 초대 링크, 바로가기)
- 운동회 정보 수정: 제목, 일시, 집합 안내, 인증코드 변경, 상태 변경
- 참가자 관리: 목록, 성별·덩치·운동능력 등급 입력, 출석 상태 토글, 삭제. 본인(생성자)은 삭제 불가
- 공지: 작성, 수정, 삭제, 고정 토글
- 시간표: 이미지 업로드(jpg, png, webp, gif, 최대 5MB), 캡션, 순서 변경, 삭제. 삭제 시 파일도 삭제

### 플랫폼 관리자 (`/admin/...`)
- `GET|POST /admin/login`, `POST /admin/logout`
- `GET /admin`: 전체 운동회 목록(회차, 제목, 참가자 수, 상태, 생성일)
- `GET /admin/events/:id`: 상세. 참가자 목록, 공지, 시간표, 생성자 기능 전체를 대신 수행할 수 있는 링크
- 참가자 PIN 재설정, 생성자 PIN 재설정: 새 값을 직접 입력
- 운동회 삭제(확인 입력 필요)
- 관리자는 생성자 화면에 그대로 진입할 수 있다(5절 requireCreator 참고)
- 마니또 잠금 토글과 민감정보 화면은 3단계에서 추가하며, 관리자 화면의 마니또·익명 투표 관련 이름은 `mask.js`로 마스킹한다. 규칙: 2자 이름은 `홍*`, 3자 이상은 첫 글자와 마지막 글자만 남기고 `*`(예: `홍*동`, `남**원`)

## 7. 화면 디자인

- 모바일 우선, 단일 컬럼, 최대 폭 480px. 관리자 화면은 넓은 표를 위해 960px
- 첨부된 제3회 시간표 포스터의 톤을 따른다. 주황(`#FF8A3D`)과 하늘(`#3FB6F0`) 포인트, 흰 배경, 굵은 둥근 제목
- 폰트는 Google Fonts의 Pretendard 대체로 `Noto Sans KR`, 제목은 `Black Han Sans`
- 팀 기본 색: 레드 `#E74C3C`, 블루 `#3498DB`, 그린 `#27AE60`, 옐로우 `#F1C40F`
- CSS 프레임워크 없이 `app.css` 한 파일

## 8. 에러 처리

- 폼 검증 실패: 같은 폼을 400으로 다시 렌더링하고 입력값과 메시지 유지
- 없는 운동회나 리소스: 404 페이지
- 권한 없음: 해당 로그인 폼으로 리다이렉트
- 업로드 형식·용량 위반: 폼에 메시지
- 예기치 않은 에러: 콘솔 로그 후 500 페이지. 운영 환경에서는 스택을 노출하지 않음
- DB 유니크 위반(이름 중복 등)은 서비스 계층에서 잡아 사용자 메시지로 바꾼다

## 9. 테스트

- `npm test`는 `TEST_DATABASE_URL`에 마이그레이션을 적용하고, 각 테스트 파일 시작 시 테이블을 비운다
- 서비스 단위 테스트: 운동회 생성 기본값, slug·인증코드 형식, 입장 신규/재접속/PIN 불일치/인증코드 불일치, 이름 중복, 마스킹 규칙
- 라우트 통합 테스트(supertest): 세 역할의 접근 제어, 생성 → 입장 → 공지 작성 → 참가자 홈 노출, 이미지 업로드 형식 거부, 관리자 PIN 재설정 후 새 PIN으로 재접속

## 10. 로컬 PostgreSQL 17 설정

Homebrew 기준이다.

```bash
brew install postgresql@17
brew services start postgresql@17
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

psql postgres <<'SQL'
CREATE ROLE sportsday WITH LOGIN PASSWORD '원하는비밀번호';
CREATE DATABASE sportsday OWNER sportsday ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE sportsday_test OWNER sportsday ENCODING 'UTF8' TEMPLATE template0;
SQL
```

이후 `.env`의 `DATABASE_URL`과 `TEST_DATABASE_URL`에 같은 비밀번호를 넣고 `npm run migrate`를 실행한다.

## 11. 범위 밖(1단계)

- 팀 뽑기, 마니또, 투표의 로직과 화면
- 배포 설정(호스팅, HTTPS)
- 이미지 리사이즈, 외부 스토리지
- 알림(푸시, 문자)
