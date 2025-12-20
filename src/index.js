import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { config } from './config/index.js';
import analyzeRoutes from './routes/analyze.js';
import battleRoutes from './routes/battle.js';
import webhookRoutes from './routes/webhook.js';
import proRoutes from './routes/pro.js';
import referralRoutes from './routes/referral.js';
import checkoutRoutes from './routes/checkout.js';
import diagRoutes from './routes/diag.js';
import eventRoutes from './routes/event.js';

// Security middleware
import { validateOrigin, costTracker } from './middleware/apiKeyAuth.js';

// ===========================================
// STARTUP VALIDATION - Log API key status
// ===========================================
console.log('🚀 FitRate API Starting...');
console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);

if (!process.env.GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY is NOT SET - Free scans will fail!');
} else {
  console.log('✅ GEMINI_API_KEY is configured');
}

if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️  OPENAI_API_KEY is not set (Pro features disabled)');
} else {
  console.log('✅ OPENAI_API_KEY is configured');
}

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('⚠️  STRIPE_SECRET_KEY is not set (Payments disabled)');
} else {
  console.log('✅ STRIPE_SECRET_KEY is configured');
}

if (!process.env.REDIS_URL) {
  console.warn('⚠️  REDIS_URL is not set (Using in-memory fallback)');
} else {
  console.log('✅ REDIS_URL is configured');
}

console.log(''); // Blank line for readability

const app = express();

// Trust proxy for Railway (fixes X-Forwarded-For warnings)
app.set('trust proxy', 1);

// CORS - MUST be before other middleware
app.use(cors({
  origin: config.allowedOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));

// Security middleware (configured for API cross-origin access)
// SECURITY: Enhanced helmet configuration
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  // Strict Transport Security - enforce HTTPS
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  // Referrer Policy - don't leak full URLs
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // X-Content-Type-Options - prevent MIME sniffing
  noSniff: true,
  // X-Frame-Options - prevent clickjacking
  frameguard: { action: 'deny' }
}));

// Request logging (use 'short' format in production to reduce PII exposure)
app.use(morgan(config.nodeEnv === 'production' ? 'short' : 'combined'));

// Body parsing
// 1. Webhook needs RAW body for signature verification
app.use('/api/webhook', express.raw({ type: 'application/json' }));

// 2. All other API routes use JSON parser (skip webhook)
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/api/webhook')) {
    next();
  } else {
    express.json({ limit: '10mb' })(req, res, next);
  }
});

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'fitrate-api',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Origin validation for API routes (skip for webhooks)
app.use('/api/', validateOrigin);

// Cost tracking for expensive endpoints
app.use('/api/analyze', costTracker('scan'));
app.use('/api/battle', costTracker('battle'));

// Routes
// SECURITY: Diag route only available in development or with valid origin
app.use('/api/diag', (req, res, next) => {
  if (config.nodeEnv === 'production') {
    // In production, only allow from authenticated admin or block entirely
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Admin access required' });
    }
  }
  next();
}, diagRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/battle', battleRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/pro', proRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/event', eventRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(config.port, () => {
  console.log(`🚀 FitRate API running on port ${config.port}`);
  console.log(`📍 Environment: ${config.nodeEnv}`);
  console.log(`⏱️  Request timeout: 30s`);
});

// Set server timeout to 30 seconds
server.timeout = 30000;

export default app;
