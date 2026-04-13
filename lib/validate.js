export function requireFields(body, fields) {
  const missing = fields.filter(f => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) {
    return { error: `Missing required fields: ${missing.join(', ')}`, status: 400 };
  }
  return null;
}

export function requireQuery(query, fields) {
  return requireFields(query, fields);
}
