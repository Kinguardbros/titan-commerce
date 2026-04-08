const requests = new Map();

export function rateLimit(key, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  const windowStart = now - windowMs;

  if (!requests.has(key)) requests.set(key, []);

  const timestamps = requests.get(key).filter((t) => t > windowStart);
  requests.set(key, timestamps);

  if (timestamps.length >= maxRequests) return false;

  timestamps.push(now);
  return true;
}
