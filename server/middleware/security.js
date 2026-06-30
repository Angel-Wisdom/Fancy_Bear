import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';

export function applySecurity(app) {
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  }));

  app.use(cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  }));

  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  }));

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const elapsed = Date.now() - start;
      console.log(`[${req.method}] ${req.path} ${res.statusCode} ${elapsed}ms`);
    });
    next();
  });
}
