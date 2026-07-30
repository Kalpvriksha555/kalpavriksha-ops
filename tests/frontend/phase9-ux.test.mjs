import test from 'node:test';
import assert from 'node:assert/strict';
import { getArchiveLocation, groupArchivedByLocation, matchesArchiveSearch, normalizeArchiveValue } from '../../frontend/src/utils/archiveUtils.js';
import { requestConfirmation, requestInput } from '../../frontend/src/services/uiFeedback.js';

test('archive locations use canonical aliases and stable grouping', () => {
  const projects = [
    { id: 'A', location: 'LKO', completedAt: 10, paymentTrackingStatus: 'Paid', paymentAmountIn: 1000 },
    { id: 'B', location: 'Lucknow', completedAt: 20, estimate: 1000, paymentTrackingStatus: 'Pending', paymentAmountIn: 250 },
    { id: 'C', location: 'VNS', completedAt: 30, paymentTrackingStatus: 'Not Updated', paymentAmountIn: 0 },
  ];
  assert.equal(getArchiveLocation(projects[0]), 'LUCKNOW');
  const groups = groupArchivedByLocation(projects);
  assert.equal(groups.length, 2);
  const lucknow = groups.find((group) => group.location === 'LUCKNOW');
  assert.equal(lucknow.items.length, 2);
  assert.equal(lucknow.unpaid, 1);
  assert.equal(lucknow.received, 1250);
});

test('archive search is case and punctuation insensitive', () => {
  const project = { id: 'VNS-PNB-01', customerName: 'Ravi Kumar', location: 'Varanasi', assignedTo: 'Nilu Gupta' };
  assert.equal(matchesArchiveSearch(project, 'ravi-kumar'), true);
  assert.equal(matchesArchiveSearch(project, 'nilu'), true);
  assert.equal(matchesArchiveSearch(project, 'lucknow'), false);
  assert.equal(normalizeArchiveValue('Prayágrāj'), 'PRAYAGRAJ');
});

test('dialog requests fail closed during non-browser verification', async () => {
  assert.equal(await requestConfirmation('Confirm'), false);
  assert.equal(await requestInput('Input'), null);
});
