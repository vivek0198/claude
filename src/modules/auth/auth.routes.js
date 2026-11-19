import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { authLimiter, emailLimiter, loginLimiter, registerLimiter } from '../../middleware/rateLimit.js';
import * as c from './auth.controller.js';
import * as s from './auth.validation.js';

// Express 5 forwards rejected promises from async handlers to the error handler.
const router = Router();

router.use(authLimiter);

router.post('/register', registerLimiter, validate(s.registerSchema), c.register);
router.post('/login', loginLimiter, validate(s.loginSchema), c.login);
router.post('/refresh', validate(s.refreshSchema), c.refresh);
router.post('/logout', validate(s.refreshSchema), c.logout);
router.post('/logout-all', authenticate, c.logoutAll);
router.get('/me', authenticate, c.me);

router.post('/verify-email', validate(s.verifyEmailSchema), c.verifyEmail);
router.post('/resend-verification', emailLimiter, validate(s.emailOnlySchema), c.resendVerification);

router.post('/forgot-password', emailLimiter, validate(s.emailOnlySchema), c.forgotPassword);
router.post('/reset-password', validate(s.resetPasswordSchema), c.resetPassword);
router.post('/change-password', authenticate, validate(s.changePasswordSchema), c.changePassword);

export default router;
