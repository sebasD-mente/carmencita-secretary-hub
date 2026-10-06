import http from 'node:http';
import { URL } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const PORT = parseInt(process.env.AUTH_PORT || '3456', 10);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n❌ ERROR: Se requieren GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en las variables de entorno o archivo .env');
  console.error('Ejemplo: node --env-file=.env scripts/get-google-token.js\n');
  process.exit(1);
}

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/devstorage.read_write',
].join(' ');

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent`;

console.log('\n==================================================');
console.log('🔗 AUTORIZACIÓN DE GOOGLE WORKSPACE & CLOUD STORAGE');
console.log('==================================================');
console.log('\n1. Abre este enlace en tu navegador:\n');
console.log(authUrl);
console.log('\n2. Inicia sesión con tu cuenta de Google y dale "Continuar / Permitir".');
console.log(`Esperando respuesta en http://localhost:${PORT}...\n`);

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    if (reqUrl.pathname === '/callback') {
      const code = reqUrl.searchParams.get('code');
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Error: No se recibió código de autorización.</h1>');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>✅ ¡Autorización exitosa!</h1><p>Ya puedes cerrar esta pestaña y volver a la consola.</p>');

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      });

      const tokens = await tokenResponse.json();

      if (!tokens.refresh_token) {
        console.error('⚠️ No se recibió refresh_token. Es posible que ya hayas autorizado antes.');
        console.log('Respuesta recibida:', tokens);
      } else {
        console.log('==================================================');
        console.log('🎉 ¡REFRESH TOKEN OBTENIDO CON ÉXITO!');
        console.log('==================================================\n');
        console.log('Variables listas para el .env del VPS:\n');
        console.log(`GOOGLE_CLIENT_ID="${CLIENT_ID}"`);
        console.log(`GOOGLE_CLIENT_SECRET="${CLIENT_SECRET}"`);
        console.log(`GOOGLE_REFRESH_TOKEN="${tokens.refresh_token}"`);
        console.log('\n==================================================');
      }

      server.close();
      process.exit(0);
    }
  } catch (err) {
    console.error('Error procesando autenticación:', err);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT);
