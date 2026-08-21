export const SQLI_PAYLOADS = [
  "' OR 1=1 --",
  "'; DROP TABLE users; --",
  "1; DELETE FROM users WHERE 1=1; --",
  "' UNION SELECT * FROM users --",
];
