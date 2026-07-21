/* eslint-disable no-await-in-loop */
/* eslint-disable no-plusplus */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Credentials for the default test user (adjust if needed)
const testUser = {
  email: process.env.TEST_USER_EMAIL || 'test@example.com',
  password: process.env.TEST_USER_PASSWORD || 'password123',
};

// Helper to pause execution
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Write a JSON example file (overwrites with actual token values)
function writeExample(relPath, content) {
  const examplesDir = path.resolve(__dirname, '..', 'openapi_examples');
  /* eslint-disable security/detect-non-literal-fs-filename */
  fs.writeFileSync(path.join(examplesDir, relPath), `${JSON.stringify(content, null, 2)}\n`, { encoding: 'utf8' });
  /* eslint-enable security/detect-non-literal-fs-filename */
  process.stdout.write(`Example written: ${relPath}\n`);
}

(async () => {
  // Wait for the Node app health endpoint before attempting login
  async function waitForApp() {
    const healthUrl = 'http://node-app:3000/v1/docs';
    const maxHealthAttempts = 30;
    for (let i = 1; i <= maxHealthAttempts; i++) {
      try {
        await axios.get(healthUrl);
        process.stdout.write('App is healthy.\n');
        break;
      } catch (e) {
        await sleep(2000);
      }
    }
  }
  await waitForApp();

  const maxAttempts = 20;
  let attempt = 0;
  let accessToken;

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
      if (response.data && response.data.tokens && response.data.tokens.access) {
        accessToken = response.data.tokens.access.token;
      }

      if (accessToken) break;
    } catch (err) {
      // Likely service not ready or login failed
    }

    attempt++;
    const delay = 5000 * attempt;
    process.stderr.write(`Token generator: attempt ${attempt} failed, retrying in ${delay / 1000}s...\n`);
    await sleep(delay);
  }

  if (!accessToken) {
    process.stderr.write('Token generator: unable to obtain token after retries\n');
    process.exit(1);
  }

  // ── DB operations ────────────────────────────────────────────────────────────
  const baseMongoUrl = process.env.MONGODB_URL || 'mongodb://mongodb:27017/node-boilerplate';
  const mongoUrl = baseMongoUrl + (process.env.NODE_ENV === 'test' ? '-test' : '');
  const jwtSecret = process.env.JWT_SECRET || 'thisisasamplesecret';
  let fakeRefreshToken;
  let fakeLogoutToken;
  let resetPasswordToken;
  let verifyEmailToken;

  try {
    /* eslint-disable global-require */
    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');
    /* eslint-enable global-require */

    await mongoose.connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true });
    process.stdout.write('Connected to MongoDB.\n');

    const usersCol = mongoose.connection.db.collection('users');
    const tokensCol = mongoose.connection.db.collection('tokens');

    const fakeId = mongoose.Types.ObjectId('5ebac534954b54139806c112');
    // Second fake user – used only by the DELETE example so it doesn't clobber the first
    const fake2Id = mongoose.Types.ObjectId('5ebac534954b54139806c113');

    // Promote testUser to admin
    await usersCol.updateOne({ email: testUser.email }, { $set: { role: 'admin' } });

    // ── Seed fake user 1 (used by login, refresh, forgot-password, get, patch) ──
    const hashedPw1 = await bcrypt.hash('password1', 8);
    // Safe upsert: delete any doc that matches EITHER the email OR the target _id,
    // then insert with the exact _id we need.
    await usersCol.deleteMany({ $or: [{ email: 'fake@example.com' }, { _id: fakeId }] });
    await usersCol.insertOne({
      _id: fakeId,
      email: 'fake@example.com',
      name: 'fake name',
      role: 'user',
      password: hashedPw1,
      isEmailVerified: false,
    });
    process.stdout.write('Seeded fake user 1 (fake@example.com).\n');

    // ── Seed fake user 2 (used only by the DELETE example) ───────────────────
    const hashedPw2 = await bcrypt.hash('password2', 8);
    await usersCol.deleteMany({ $or: [{ email: 'fake2@example.com' }, { _id: fake2Id }] });
    await usersCol.insertOne({
      _id: fake2Id,
      email: 'fake2@example.com',
      name: 'fake name 2',
      role: 'user',
      password: hashedPw2,
      isEmailVerified: false,
    });
    process.stdout.write('Seeded fake user 2 (fake2@example.com).\n');

    // ── Seed duplicate@example.com user (used by register 400 test) ──────────
    const hashedPwDup = await bcrypt.hash('password1', 8);
    await usersCol.deleteMany({ email: 'duplicate@example.com' });
    await usersCol.insertOne({
      email: 'duplicate@example.com',
      name: 'John Doe',
      role: 'user',
      password: hashedPwDup,
      isEmailVerified: false,
    });
    process.stdout.write('Seeded duplicate user.\n');

    // ── Clean up newuser@example.com so POST /users example can create it ────
    await usersCol.deleteMany({
      email: {
        $in: [
          'newuser@example.com',
          'newuser-user@example.com',
          'newuser-admin@example.com',
          'john@example.com',
          'newadmin@example.com',
        ],
      },
    });
    process.stdout.write('Cleaned up newuser/john/newadmin email(s).\n');

    // ── Generate real refresh token for fake user 1 (used by refresh-tokens) ──
    const now = Math.floor(Date.now() / 1000);
    const refreshExpires = now + 30 * 24 * 60 * 60; // 30 days
    fakeRefreshToken = jwt.sign({ sub: fakeId.toString(), iat: now, exp: refreshExpires, type: 'refresh' }, jwtSecret);

    // ── Generate a SECOND refresh token (used by logout) ─────────────────────
    fakeLogoutToken = jwt.sign({ sub: fakeId.toString(), iat: now + 1, exp: refreshExpires, type: 'refresh' }, jwtSecret);

    await tokensCol.deleteMany({ user: fakeId, type: 'refresh' });
    await tokensCol.insertMany([
      {
        token: fakeRefreshToken,
        user: fakeId,
        type: 'refresh',
        expires: new Date(refreshExpires * 1000),
        blacklisted: false,
      },
      {
        token: fakeLogoutToken,
        user: fakeId,
        type: 'refresh',
        expires: new Date(refreshExpires * 1000),
        blacklisted: false,
      },
    ]);
    process.stdout.write('Generated refresh tokens for fake user 1.\n');

    // ── Generate real reset-password token for fake user 1 ───────────────────
    const resetExpires = now + 10 * 60; // 10 minutes
    resetPasswordToken = jwt.sign({ sub: fakeId.toString(), iat: now, exp: resetExpires, type: 'resetPassword' }, jwtSecret);
    await tokensCol.deleteMany({ user: fakeId, type: 'resetPassword' });
    await tokensCol.insertOne({
      token: resetPasswordToken,
      user: fakeId,
      type: 'resetPassword',
      expires: new Date(resetExpires * 1000),
      blacklisted: false,
    });
    process.stdout.write('Generated reset-password token for fake user 1.\n');

    // ── Generate real verify-email token for fake user 1 ─────────────────────
    const verifyExpires = now + 10 * 60; // 10 minutes
    verifyEmailToken = jwt.sign({ sub: fakeId.toString(), iat: now, exp: verifyExpires, type: 'verifyEmail' }, jwtSecret);
    await tokensCol.deleteMany({ user: fakeId, type: 'verifyEmail' });
    await tokensCol.insertOne({
      token: verifyEmailToken,
      user: fakeId,
      type: 'verifyEmail',
      expires: new Date(verifyExpires * 1000),
      blacklisted: false,
    });
    process.stdout.write('Generated verify-email token for fake user 1.\n');

    await mongoose.disconnect();
    process.stdout.write('Disconnected from MongoDB.\n');
  } catch (dbErr) {
    process.stderr.write(`Token generator DB error: ${dbErr.message}\n${dbErr.stack}\n`);
  }

  // ── Write token/.env ────────────────────────────────────────────────────────
  const tokenDir = path.resolve(__dirname, '..', 'token');
  /* eslint-disable security/detect-non-literal-fs-filename */
  if (!fs.existsSync(tokenDir)) fs.mkdirSync(tokenDir);
  const envPath = path.join(tokenDir, '.env');
  const envContent = `${[
    `BEARER_TOKEN=${accessToken}`,
    `bearerAuth=${accessToken}`,
    `SPECMATIC_BEARER_AUTH=${accessToken}`,
    `REFRESH_TOKEN=${fakeRefreshToken || ''}`,
    `RESET_PASSWORD_TOKEN=${resetPasswordToken || ''}`,
    `VERIFY_EMAIL_TOKEN=${verifyEmailToken || ''}`,
  ].join('\n')}\n`;
  fs.writeFileSync(envPath, envContent, { encoding: 'utf8' });
  /* eslint-enable security/detect-non-literal-fs-filename */
  process.stdout.write(`Tokens written to ${envPath}\n`);

  // ── Rewrite example files with REAL token values (bypasses Specmatic fact store) ──
  if (fakeRefreshToken) {
    writeExample('auth_logout_POST_204.json', {
      'http-request': {
        method: 'POST',
        path: '/auth/logout',
        headers: { 'Content-Type': 'application/json' },
        body: { refreshToken: fakeRefreshToken },
      },
      'http-response': { status: 204 },
    });

    writeExample('auth_refresh-tokens_POST_200.json', {
      'http-request': {
        method: 'POST',
        path: '/auth/refresh-tokens',
        headers: { 'Content-Type': 'application/json' },
        body: { refreshToken: fakeRefreshToken },
      },
      'http-response': {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          access: {
            token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder',
            expires: '2035-01-01T00:00:00.000Z',
          },
          refresh: {
            token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder',
            expires: '2035-02-01T00:00:00.000Z',
          },
        },
      },
    });
  }

  if (resetPasswordToken) {
    writeExample('auth_reset-password_POST_204.json', {
      'http-request': {
        method: 'POST',
        path: '/auth/reset-password',
        query: { token: resetPasswordToken },
        headers: { 'Content-Type': 'application/json' },
        body: { password: 'password1' },
      },
      'http-response': { status: 204 },
    });
  }

  if (verifyEmailToken) {
    writeExample('auth_verify-email_POST_204.json', {
      'http-request': {
        method: 'POST',
        path: '/auth/verify-email',
        query: { token: verifyEmailToken },
      },
      'http-response': { status: 204 },
    });
  }

  // ── Rewrite register example (clean email ensures 201) ─────────────────────
  writeExample('auth_register_POST_201.json', {
    'http-request': {
      method: 'POST',
      path: '/auth/register',
      headers: { 'Content-Type': 'application/json' },
      body: {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password1',
      },
    },
    'http-response': {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      body: {
        user: {
          id: '(string)',
          email: 'john@example.com',
          name: 'John Doe',
          role: 'user',
          isEmailVerified: false,
        },
        tokens: {
          access: {
            token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder',
            expires: '2035-01-01T00:00:00.000Z',
          },
          refresh: {
            token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder',
            expires: '2035-02-01T00:00:00.000Z',
          },
        },
      },
    },
  });

  // ── Rewrite login example (ensures seeded user credentials match) ──────────
  writeExample('auth_login_POST_200.json', {
    'http-request': {
      method: 'POST',
      path: '/auth/login',
      headers: { 'Content-Type': 'application/json' },
      body: {
        email: 'fake@example.com',
        password: 'password1',
      },
    },
    'http-response': {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        user: {
          id: '5ebac534954b54139806c112',
          email: 'fake@example.com',
          name: 'fake name',
          role: 'user',
          isEmailVerified: false,
        },
        tokens: {
          access: {
            token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder',
            expires: '2035-01-01T00:00:00.000Z',
          },
          refresh: {
            token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder',
            expires: '2035-02-01T00:00:00.000Z',
          },
        },
      },
    },
  });

  writeExample('auth_refresh-tokens_POST_200.json', {
    'http-request': {
      method: 'POST',
      path: '/auth/refresh-tokens',
      headers: { 'Content-Type': 'application/json' },
      body: { refreshToken: fakeRefreshToken },
    },
    'http-response': {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        access: {
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder',
          expires: '2035-01-01T00:00:00.000Z',
        },
        refresh: {
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder',
          expires: '2035-02-01T00:00:00.000Z',
        },
      },
    },
  });

  // ── Rewrite logout example ───────────────────────────────────────────────
  writeExample('auth_logout_POST_204.json', {
    'http-request': {
      method: 'POST',
      path: '/auth/logout',
      headers: { 'Content-Type': 'application/json' },
      body: { refreshToken: fakeLogoutToken },
    },
    'http-response': { status: 204 },
  });

  // ── Rewrite forgot-password example (ensures seeded user exists) ───────────
  writeExample('auth_forgot-password_POST_204.json', {
    'http-request': {
      method: 'POST',
      path: '/auth/forgot-password',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'fake@example.com' },
    },
    'http-response': { status: 204 },
  });

  writeExample('auth_send-verification-email_POST_204.json', {
    'http-request': {
      method: 'POST',
      path: '/auth/send-verification-email',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    'http-response': { status: 204 },
  });

  // Rewrite authenticated User API examples to include Authorization header
  writeExample('users_GET_200.json', {
    'http-request': {
      method: 'GET',
      path: '/users',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      query: {
        name: 'fake',
        role: 'user',
        sortBy: 'name:asc',
        limit: '10',
        page: '1',
      },
    },
    'http-response': {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        results: [
          {
            id: '5ebac534954b54139806c112',
            email: 'fake@example.com',
            name: 'fake name',
            role: 'user',
            isEmailVerified: false,
          },
        ],
        page: 1,
        limit: 10,
        totalPages: 1,
        totalResults: 1,
      },
    },
  });

  writeExample('users_userId_GET_200.json', {
    'http-request': {
      method: 'GET',
      path: '/users/5ebac534954b54139806c112',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    'http-response': {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        id: '5ebac534954b54139806c112',
        email: 'fake@example.com',
        name: 'fake name',
        role: 'user',
        isEmailVerified: false,
      },
    },
  });

  writeExample('users_userId_PATCH_200.json', {
    'http-request': {
      method: 'PATCH',
      path: '/users/5ebac534954b54139806c112',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: {
        name: 'fake name',
        email: 'fake@example.com',
        password: 'password1',
      },
    },
    'http-response': {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        id: '5ebac534954b54139806c112',
        email: 'fake@example.com',
        name: 'fake name',
        role: 'user',
        isEmailVerified: false,
      },
    },
  });

  writeExample('users_userId_DELETE_204.json', {
    'http-request': {
      method: 'DELETE',
      path: '/users/5ebac534954b54139806c113',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    'http-response': {
      status: 204,
    },
  });

  writeExample('users_POST_201.json', {
    'http-request': {
      method: 'POST',
      path: '/users',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: {
        name: 'new user',
        email: 'newuser@example.com',
        password: 'password1',
        role: 'user',
      },
    },
    'http-response': {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      body: {
        id: '(string)',
        email: 'newuser@example.com',
        name: 'new user',
        role: 'user',
        isEmailVerified: false,
      },
    },
  });

  // ── Separate admin-role example with a unique email to avoid collisions ────
  writeExample('users_POST_201_admin.json', {
    'http-request': {
      method: 'POST',
      path: '/users',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: {
        name: 'new admin',
        email: 'newadmin@example.com',
        password: 'password1',
        role: 'admin',
      },
    },
    'http-response': {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      body: {
        id: '(string)',
        email: 'newadmin@example.com',
        name: 'new admin',
        role: 'admin',
        isEmailVerified: false,
      },
    },
  });

  process.stdout.write('Token generator completed successfully.\n');
})();
