const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const ocrHandler = require('../api/ocr');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 3000);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function loadLocalEnvironment() {
  const envPath = path.join(root, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function serveStatic(request, response) {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(root, `.${requested}`);
  if (!filePath.startsWith(`${root}${path.sep}`) || path.basename(filePath).startsWith('.')) {
    response.writeHead(404).end('Not found');
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(content);
  });
}

function handleOcr(request, response) {
  let body = '';
  request.on('data', chunk => {
    body += chunk;
    if (body.length > 4_000_000) {
      response.writeHead(413, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'The cropped image is too large. Try a smaller photo.' }));
      request.destroy();
    }
  });
  request.on('end', async () => {
    if (response.writableEnded) return;
    let parsed;
    try {
      parsed = JSON.parse(body || '{}');
    } catch {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Invalid request body.' }));
      return;
    }

    const adapter = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader(name, value) {
        response.setHeader(name, value);
      },
      json(value) {
        response.writeHead(this.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(value));
      },
    };
    try {
      await ocrHandler({ method: request.method, body: parsed, headers: request.headers }, adapter);
    } catch (error) {
      console.error('Local OCR route failed:', error);
      if (!response.writableEnded) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'The local OCR service failed.' }));
      }
    }
  });
}

loadLocalEnvironment();
http.createServer((request, response) => {
  if (request.url.split('?')[0] === '/api/ocr') return handleOcr(request, response);
  if (request.url.startsWith('/api/')) {
    response.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'API route not found.' }));
    return;
  }
  serveStatic(request, response);
}).listen(port, '127.0.0.1', () => {
  console.log(`Gridwork is running at http://localhost:${port}`);
  if (!process.env.GEMINI_API_KEY) console.log('Set GEMINI_API_KEY in .env.local to enable Gemini OCR.');
});
