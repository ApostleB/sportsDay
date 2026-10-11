# 명량운동회

매년 여는 "제 n회 명량운동회"를 운영하는 웹 플랫폼입니다.

## 준비

1. PostgreSQL 17을 설치하고 `sportsday` 역할과 `sportsday`, `sportsday_test` DB를 만듭니다.
   자세한 명령어는 `docs/superpowers/specs/2026-10-11-sportsday-foundation-design.md`의 10절에 있습니다.
2. `.env.example`을 `.env`로 복사하고 값을 채웁니다.
3. 아래 명령어를 실행합니다.

```bash
npm install
npm run migrate
npm run dev
```

## 테스트

```bash
npm test
```
