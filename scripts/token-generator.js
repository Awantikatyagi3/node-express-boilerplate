const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Credentials for the default test user (adjust if needed)
const testUser = {
  email: process.env.TEST_USER_EMAIL || 'test@example.com',
  password: process.env.TEST_USER_PASSWORD || 'password123',
};

(async () => {
  try {
    let response = await axios.post('http://node-app:3000/v1/auth/login', testUser);
    let token = response.data.token || response.data.accessToken || response.data.BEARER_TOKEN;

    // If login failed (no token), attempt to register then login again
    if (!token) {
      // Register the test user
      await axios.post('http://node-app:3000/v1/auth/register', {
        name: 'Specmatic Test',
        email: testUser.email,
        password: testUser.password,
      });
      // Retry login
      response = await axios.post('http://node-app:3000/v1/auth/login', testUser);
      token = response.data.token || response.data.accessToken || response.data.BEARER_TOKEN;

      if (!token) {
        process.stderr.write('Unable to obtain token after registration\n');
        process.exit(1);
      }
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
  } catch (err) {
    process.stderr.write(`Error obtaining token: ${err.message}\n`);
    process.exit(1);
  }
})();
