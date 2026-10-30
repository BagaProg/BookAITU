const router = require('express').Router();
const pool = require('../db');

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, email, name, role, created_at FROM users WHERE is_active ORDER BY id'
  );
  res.json(rows);
});

module.exports = router;
