const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const http = require('http');
const url = require('url');
const open = require('open');

// Load from .env.local or environment — never commit real client secrets
const clientId = process.env.GOOGLE_CLIENT_ID || '';
const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000';

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the environment (e.g. .env.local).');
  process.exit(1);
}

const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

async function runAuth() {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  console.log('Authorize this app by visiting this url:', authUrl);
  await open(authUrl);

  http.createServer(async (req, res) => {
    try {
      const parsedUrl = url.parse(req.url, true);
      if (parsedUrl.pathname === '/' && parsedUrl.query.code) {
        const { tokens } = await oauth2Client.getToken(parsedUrl.query.code);
        fs.writeFileSync('token.json', JSON.stringify(tokens));
        res.end('Authentication successful! You can close this window.');
        console.log('token.json saved.');
        process.exit(0);
      }
    } catch (err) {
      console.error(err);
      res.end('Auth failed.');
    }
  }).listen(3000);
}

runAuth();
