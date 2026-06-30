import { randomUUID } from 'node:crypto';
import { getDb } from '../db/database.js';

export function writeAuditEntry({ userId = null, action, resourceType = null, resourceId = null, details = null, ipAddress = null, userAgent = null }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO audit_log (id, user_id, action, resource_type, resource_id, details_json, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    userId,
    action,
    resourceType,
    resourceId,
    details ? JSON.stringify(details) : null,
    ipAddress,
    userAgent,
  );
}
