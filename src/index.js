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

import diagRoutes from './routes/diag.js';

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
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
}));
app.use(morgan('combined'));

// Body parsing (exclude webhook route - needs raw body)
app.use('/api/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

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

// Routes
app.use('/api/diag', diagRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/battle', battleRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/pro', proRoutes);
app.use('/api/referral', referralRoutes);

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
