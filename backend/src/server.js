const express = require('express');
const path = require('node:path');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
require('./db');
const { createAuth } = require('./auth');

function createApp(options = {}) {
  const app = express();
  const auth = createAuth(options.auth);
  app.locals.auth = auth;
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: auth.config.origin, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'X-CSRF-Token'] }));
  app.use(express.json({ limit: '16kb' }));
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));

  app.use('/api', auth.sessionMiddleware);
  app.use('/api/auth', auth.router);
  app.use('/api', auth.requireAuth, auth.csrf);
  app.use('/api/admin', auth.requireAdmin, require('./routes/admin'));
  app.use('/api/users', auth.requireAdmin, require('./routes/users'));
  app.use('/api/rooms', require('./routes/rooms'));
  app.use('/api/bookings', require('./routes/bookings'));

  if (process.env.SERVE_FRONTEND === 'true') {
    const frontend = path.resolve(__dirname, '../../frontend/dist');
    app.use(express.static(frontend));
    app.get('/{*path}', (req, res, next) => {
      if (req.path === '/api' || req.path.startsWith('/api/')) return next();
      if (path.extname(req.path) || req.path.split('/').some(segment => segment.startsWith('.'))) return next();
      res.sendFile(path.join(frontend, 'index.html'));
    });
  }

  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    if (error.code === 'ADMIN_OPERATION_REJECTED') return res.status(error.status).json({ error: error.message });
    if (['ACCOUNT_DISABLED', 'ACCOUNT_LINK_REQUIRED', 'ALREADY_ENROLLED', 'ENROLLMENT_REQUIRED'].includes(error.code)) return res.status(error.status || 403).json({ error: error.code, code: error.code });
    console.error('API request failed:', error.code || error.name);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
const app = createApp();

if (require.main === module) {
  const port = process.env.PORT || 3001;
  app.listen(port, process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'), error => {
    if (error) { console.error('Server failed to listen:', error.code || error.name); process.exitCode = 1; }
    else console.log(`Server on ${port}`);
  });
}

module.exports = app;
module.exports.createApp = createApp;
