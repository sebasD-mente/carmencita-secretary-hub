/**
 * ⚠️ DEPRECADO PARA PRODUCCIÓN (ESTÁNDAR DEKO LABS ENTERPRISE)
 * 
 * Directiva DIR-DEKO-COMM-001 / Puntos 08 y 27:
 * Carmencita Secretary Hub ahora se ejecuta de forma exclusiva y aislada
 * mediante contenedores Docker en Dokploy (Dockerfile y docker-compose.yml).
 * 
 * Este archivo se conserva únicamente como referencia de desarrollo histórico.
 * PROHIBIDO EJECUTAR 'pm2 start' O 'pm2 restart --update-env' EN EL HOST VPS.
 */
module.exports = {
  apps: [
    {
      name: 'carmencita-hub-deprecated',
      script: 'src/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: false,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 3050,
      },
    },
  ],
};
