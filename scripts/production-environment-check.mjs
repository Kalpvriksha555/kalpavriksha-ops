import { validateProductionEnvironment } from '../backend/src/services/releaseCertificationService.js';

const result = validateProductionEnvironment(process.env);
if (!result.ok) {
  for (const item of result.errors) console.error(`${item.id}: ${item.message}`);
  process.exitCode = 1;
} else {
  console.log('Production environment validation passed.');
}
