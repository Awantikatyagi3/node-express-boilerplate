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
  // Wait for the Node app health endpoint before attempting login
  async function waitForApp() {
    const healthUrl = 'http://node-app:3000/v1/docs';
    const maxHealthAttempts = 30;
    for (let i = 1; i <= maxHealthAttempts; i++) {
      try {
        await axios.get(healthUrl);
        break;
      } catch (e) {
        await sleep(2000);
      }
    }
  }
  await waitForApp();
  const maxAttempts = 20;
  let attempt = 0;
  let token;
  while (attempt < maxAttempts) {
    try {
      // Always attempt to register first. If it fails (e.g. email already exists), it's fine.
      try {
        await axios.post('http://node-app:3000/v1/auth/register', {
          name: 'Specmatic Test',
          email: testUser.email,
          password: testUser.password,
        });
      } catch (regErr) {
        // Ignore registration errors (likely user already exists)
      }

      // Now attempt to login
      const response = await axios.post('http://node-app:3000/v1/auth/login', testUser);
      token = response.data.token || response.data.accessToken || response.data.BEARER_TOKEN;
      if (token) break; // success
    } catch (err) {
      // Likely service not ready or login failed
    }
    attempt++;
    const delay = 5000 * attempt; // 5 s * attempt
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
// Duplicate code removed - original retry implementation retained
