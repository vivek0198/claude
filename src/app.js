import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import authRoutes from './modules/auth/auth.routes.js';
import userRoutes from './modules/users/user.routes.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

function createApp() {
  const app = express();

  // Behind a reverse proxy (nginx, Apache, a load balancer), uncomment so
  // req.ip, and therefore rate limiting, sees the real client IP:
  // app.set('trust proxy', 1);

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export { createApp };
