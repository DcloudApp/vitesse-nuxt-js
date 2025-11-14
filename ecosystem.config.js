module.exports = {
  apps: [{
    name: 'my-nuxt-app',
    script: '.output/server/index.mjs',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      NITRO_PORT: 3000,
      NITRO_HOST: '127.0.0.1'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_memory_restart: '1G'
  }]
}

