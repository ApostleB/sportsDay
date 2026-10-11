const config = require('./config');
const { createApp } = require('./app');

createApp().listen(config.port, () => {
  console.log(`명량운동회 서버: http://localhost:${config.port}`);
});
