#!/usr/bin/env node

/**
 * Generate a static OpenAPI specification from the swagger-jsdoc annotations.
 *
 * Usage:
 *   node scripts/generate-openapi.js
 *
 * Output:
 *   openapi.yaml
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerDefinition = require('../src/docs/swaggerDef');

const specs = swaggerJsdoc({
  swaggerDefinition,
  apis: ['src/docs/*.yml', 'src/routes/v1/*.js'],
});

const outputPath = path.join(__dirname, '..', 'openapi.yaml');

/* eslint-disable security/detect-non-literal-fs-filename */
fs.writeFileSync(outputPath, yaml.dump(specs, { noRefs: true }), 'utf8');
/* eslint-enable security/detect-non-literal-fs-filename */

process.stdout.write(`OpenAPI specification written to ${outputPath}\n`);
