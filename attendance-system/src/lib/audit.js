const db = require('../db/pool');

async function log(req, action, entity, entityId, details) {
  try {
    await db.query(
      'INSERT INTO audit_logs (user_id, username, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user?.id || null, req.user?.username || null, action, entity || null, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null]
    );
  } catch (e) {
    console.error('Audit log failed:', e.message);
  }
}

module.exports = { log };
