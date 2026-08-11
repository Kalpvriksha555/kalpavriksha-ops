import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getEstimateDetails, getTaskDescription } from '../../frontend/src/utils/taskDisplayUtils.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const appSource = fs.readFileSync(path.join(root, 'frontend/src/App.jsx'), 'utf8');
const operationsSource = fs.readFileSync(path.join(root, 'frontend/src/components/operations/ActiveOperationsView.jsx'), 'utf8');

test('estimate display never stringifies arbitrary records as [object Object]', () => {
  assert.equal(getEstimateDetails({ estimateDetails: {} }), '');
  assert.equal(getEstimateDetails({ estimateDetails: { unexpected: 'hidden' } }), '');
  assert.equal(getEstimateDetails({ estimateDetails: { value: '₹50,00,000' } }), '₹50,00,000');
  assert.equal(getEstimateDetails({ estimateDetails: { text: 'Bank estimate required' } }), 'Bank estimate required');
  assert.notEqual(getEstimateDetails({ estimateDetails: {} }), '[object Object]');
});

test('invalid primary estimate shape does not block a valid legacy estimate alias', () => {
  assert.equal(
    getEstimateDetails({ estimateDetails: {}, propertyEstimateValue: '₹42,00,000' }),
    '₹42,00,000',
  );
  assert.equal(
    getEstimateDetails({ estimateDetails: '   ', estimate_note: 'Use revised valuation' }),
    'Use revised valuation',
  );
});

test('task description shares the same safe scalar display boundary', () => {
  assert.equal(getTaskDescription({ description: {} }), '');
  assert.equal(getTaskDescription({ description: {}, taskDescription: 'Prepare key route map' }), 'Prepare key route map');
  assert.equal(getTaskDescription({ description: { value: 'Prepare estimate' } }), 'Prepare estimate');
});

test('project normalization preserves estimate details as display text instead of coercing them to a record', () => {
  assert.match(appSource, /next\.estimateDetails = getEstimateDetails\(source\);/);
  assert.doesNotMatch(appSource, /next\.estimateDetails = asRecord\(source\.estimateDetails\);/);
});

test('active operations renders estimate through the guarded shared display helper', () => {
  assert.match(operationsSource, /CompactTextPill label="Estimate" value=\{getEstimateDetails\(project\)\}/);
});
