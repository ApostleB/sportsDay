module.exports = {
  apps: [
    {
      name: 'sportsday',
      script: 'src/server.js',
      cwd: __dirname,
      // 시도 제한이 메모리 저장소라 단일 프로세스로만 실행한다
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '300M',
      time: true,
      // dotenv는 이미 있는 환경변수를 덮어쓰지 않으므로 아래 값이 .env보다 우선한다
      env: {
        NODE_ENV: 'production',
        PORT: 3080,
        // 재배포해도 업로드 이미지가 남도록 저장소 밖에 둔다
        UPLOAD_DIR: '/home/rocky/sportsday-uploads',
      },
    },
  ],
};
