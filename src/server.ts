import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import config from './config/env';
import generateRoutes from './routes/generate';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';

const app: Application = express();

// ============================================
// Middleware
// ============================================

// CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (config.allowedOrigins.includes(origin) || config.nodeEnv === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Body parsing - increased limits for large image uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging middleware
app.use((req: Request, res: Response, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Apply rate limiting to all API routes
app.use('/api', apiLimiter);

// ============================================
// Routes
// ============================================

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'RoopVana API Server',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/api/health',
      generate: 'POST /api/generate',
      speechToText: 'POST /api/speech-to-text',
      languages: 'GET /api/languages',
    },
  });
});

// API routes
app.use('/api', generateRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    statusCode: 404,
  });
});

// ============================================
// Error handling
// ============================================

app.use(errorHandler);

// ============================================
// Server startup
// ============================================

const startServer = () => {
  try {
    app.listen(config.port, () => {
      console.log('');
      console.log('╔═══════════════════════════════════════════════════════════╗');
      console.log('║                                                           ║');
      console.log('║            🎨 RoopVana Backend Server 🎨                 ║');
      console.log('║                                                           ║');
      console.log('╚═══════════════════════════════════════════════════════════╝');
      console.log('');
      console.log(`✅ Server running on port ${config.port}`);
      console.log(`🌍 Environment: ${config.nodeEnv}`);
      console.log(`📡 API Base URL: http://localhost:${config.port}`);
      console.log('');
      console.log('📍 Available Endpoints:');
      console.log(`   - GET  /                       → Server info`);
      console.log(`   - GET  /api/health             → Health check`);
      console.log(`   - GET  /api/languages          → Supported languages`);
      console.log(`   - POST /api/generate           → Generate image`);
      console.log(`   - POST /api/speech-to-text     → Convert speech to text`);
      console.log('');
      console.log('🔧 Services Status:');
      console.log(`   - Gemini API: ${config.geminiApiKey ? '✅ Configured' : '❌ Not configured'}`);
      console.log(`   - Speech-to-Text: ${config.googleApplicationCredentials ? '✅ Configured' : '⚠️  Optional'}`);
      console.log('');
      console.log('💡 Ready to accept requests!');
      console.log('');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any) => {
  console.error('❌ Unhandled Rejection:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n⚠️  SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer();

export default app;