const { Router } = require('express');
const { z } = require('zod');
const { authenticate } = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const { validate } = require('../../middleware/validate');
const { AppError } = require('../../utils/AppError');
const users = require('./user.repository');

// Admin-only user management, as an example of role-based access.
const router = Router();
router.use(authenticate, authorize('admin'));

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

router.get('/', validate(listQuery, 'query'), async (req, res) => {
  const { page, pageSize } = req.validated.query;
  const { users: rows, total } = await users.list({ limit: pageSize, offset: (page - 1) * pageSize });
  res.json({ users: rows, page, pageSize, total });
});

const idParams = z.object({ id: z.coerce.number().int().positive() });
const roleBody = z.object({ role: z.enum(['user', 'admin']) });

router.patch('/:id/role', validate(idParams, 'params'), validate(roleBody), async (req, res) => {
  const { id } = req.validated.params;
  if (id === req.user.id) throw AppError.badRequest('You cannot change your own role', 'SELF_ROLE_CHANGE');
  if (!(await users.updateRole(id, req.body.role))) throw AppError.notFound('User not found');
  res.json({ user: users.toPublicUser(await users.findById(id)) });
});

module.exports = router;
