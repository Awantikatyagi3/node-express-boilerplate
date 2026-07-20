/* eslint-disable no-await-in-loop */
/* eslint-disable no-plusplus */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Credentials for the default test user (adjust if needed)
const testUser = {
  email: process.env.TEST_USER_EMAIL || 'test@example.com',
  password: process.env.TEST_USER_PASSWORD || 'password123',
};

// Helper to pause execution
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  // Retry login/register until the app is reachable (max 10 attempts)
  const maxAttempts = 10;
  let attempt = 0;
  let token;
  while (attempt < maxAttempts) {
    try {
      let response = await axios.post('http://node-app:3000/v1/auth/login', testUser);
      token = response.data.token || response.data.accessToken || response.data.BEARER_TOKEN;
      if (token) break; // success
      // If login succeeded but no token, try to register then login again
      await axios.post('http://node-app:3000/v1/auth/register', {
        name: 'Specmatic Test',
        email: testUser.email,
        password: testUser.password,
      });
      response = await axios.post('http://node-app:3000/v1/auth/login', testUser);
      token = response.data.token || response.data.accessToken || response.data.BEARER_TOKEN;
      if (token) break;
    } catch (err) {
      // Likely service not ready yet
    }
    attempt++;
    const delay = 3000 * attempt; // incremental backoff
    process.stderr.write(`Token generator: attempt ${attempt} failed, retrying in ${delay / 1000}s...\n`);
    await sleep(delay);
  }

  if (!token) {
    process.stderr.write('Token generator: unable to obtain token after retries\n');
    process.exit(1);
  }

  const envContent = `BEARER_TOKEN=${token}\n`;
  const tokenDir = path.resolve(__dirname, '..', 'token');
  /* eslint-disable security/detect-non-literal-fs-filename */
  if (!fs.existsSync(tokenDir)) {
    fs.mkdirSync(tokenDir);
  }
  const envPath = path.join(tokenDir, '.env');
  fs.writeFileSync(envPath, envContent, { encoding: 'utf8' });
  /* eslint-enable security/detect-non-literal-fs-filename */
  process.stdout.write(`Token written to ${envPath}\n`);
})();
// Duplicate code removed – original retry implementation retained
