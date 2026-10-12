# 배포 (수동)

- 서버: `rocky@bytebard.cloud` (SSH 포트 2022), Rocky Linux 10, Node 24, pm2
- 도메인: https://yeong-min.bytebard.cloud → nginx → `127.0.0.1:3080`
- 앱 위치: `~/sportsDay` (git 저장소 아님, `git archive`로 올림)
- 업로드 이미지: `~/sportsday-uploads` (재배포해도 유지)
- 서버 `.env`: `~/sportsDay/.env` (DB는 서버 로컬 `127.0.0.1:5432`). 재배포 시 덮어쓰지 않는다.

## 재배포

로컬 저장소 루트에서:

```bash
git archive HEAD | ssh -p 2022 rocky@bytebard.cloud 'tar -x -C ~/sportsDay'
ssh -p 2022 rocky@bytebard.cloud 'cd ~/sportsDay && npm ci --omit=dev && NODE_ENV=production npm run migrate && pm2 restart sportsday'
```

`git archive`는 삭제된 파일을 지우지 않는다. 파일을 지운 커밋을 올릴 때는 서버에서 해당 파일을 직접 지운다.

## 처음 설치할 때 한 일

1. `deploy/nginx/yeong-min.bytebard.cloud.conf`의 80 서버 블록만 먼저 `/etc/nginx/conf.d/`에 두고 `nginx -t && systemctl reload nginx`
2. `sudo certbot certonly --webroot -w /var/www/certbot -d yeong-min.bytebard.cloud --key-type ecdsa --deploy-hook "systemctl reload nginx"` (갱신은 `certbot-renew.timer`)
3. 전체 설정으로 교체 후 다시 reload
4. `pm2 start ecosystem.config.cjs && pm2 save` (재부팅 시 `pm2-rocky.service`가 복구)

## 확인

```bash
pm2 logs sportsday --lines 50
curl -I https://yeong-min.bytebard.cloud/
```
