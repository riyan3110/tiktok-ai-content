module.exports = {
  apps: [{
    name: 'tiktok-ai-content',
    script: 'src/server.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '500M',
    env: { NODE_ENV: 'production', PORT: 3000 }
  }]
};
