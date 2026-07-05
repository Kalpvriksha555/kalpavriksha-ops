export const PAYMENT_TRACKING_OPTIONS = ['Not Updated', 'Pending', 'Paid'];

const normalizePaymentValue = (value = '') => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export const getPaymentEstimateAmount = (project = {}) => {
  const raw = project.estimate ?? project.estimateAmount ?? project.amount ?? project.totalAmount ?? project.ledger?.expectedAmount ?? 0;
  const cleaned = typeof raw === 'string' ? raw.replace(/[^0-9.-]/g, '') : raw;
  return Math.max(0, Number(cleaned) || 0);
};

export const getPaymentReceivedAmount = (project = {}) => {
  const raw = project.ledger?.amountIn ?? project.paymentAmountIn ?? project.amountReceived ?? project.receivedAmount ?? 0;
  const cleaned = typeof raw === 'string' ? raw.replace(/[^0-9.-]/g, '') : raw;
  return Math.max(0, Number(cleaned) || 0);
};

export const derivePaymentTrackingStatusFromData = (project = {}) => {
  const ledger = project.ledger || {};
  const estimate = getPaymentEstimateAmount(project);
  const amountIn = getPaymentReceivedAmount(project);
  const rawStatus = normalizePaymentValue(project.paymentTrackingStatus || project.paymentStatus || project.paymentReceived || ledger.status || ledger.paymentStatus || '');
  const hasAnyFinanceData = Boolean(
    estimate > 0 || amountIn > 0 || ledger.date || ledger.receivedFrom || ledger.txnId || ledger.transactionId || ledger.mode ||
    project.paymentDate || project.paymentTime || ledger.updatedAt || project.paymentTrackingUpdatedAt
  );

  // Paid is valid only when a positive amount is actually received.
  if (amountIn > 0) {
    if (estimate > 0 && amountIn < estimate) return 'Pending';
    return 'Paid';
  }

  // Estimate or other payment information exists, but no money has been received yet.
  if (estimate > 0 || rawStatus === 'PENDING' || rawStatus === 'PARTIAL' || hasAnyFinanceData) return 'Pending';

  return 'Not Updated';
};

export const getPaymentTrackingStatus = (project = {}) => {
  const explicit = String(project.paymentTrackingStatus || project.paymentTrackStatus || '').trim();
  const normalizedExplicit = explicit
    ? PAYMENT_TRACKING_OPTIONS.find(option => normalizePaymentValue(option) === normalizePaymentValue(explicit))
    : '';
  const dataStatus = derivePaymentTrackingStatusFromData(project);

  // Never allow a stale manual "Paid" value to override missing payment data.
  if (normalizedExplicit === 'Paid' && dataStatus !== 'Paid') return dataStatus;
  // If financial values exist, they are the source of truth.
  if (dataStatus !== 'Not Updated') return dataStatus;
  return normalizedExplicit || dataStatus;
};

export const getPaymentStatusBadgeClass = (status = 'Not Updated') => {
  switch (getPaymentTrackingStatus({ paymentTrackingStatus: status })) {
    case 'Paid':
      return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    case 'Pending':
      return 'bg-amber-50 text-amber-700 border-amber-100';
    default:
      return 'bg-rose-50 text-rose-700 border-rose-100';
  }
};

export const getPaymentStatusDotClass = (status = 'Not Updated') => {
  switch (getPaymentTrackingStatus({ paymentTrackingStatus: status })) {
    case 'Paid': return 'bg-emerald-500';
    case 'Pending': return 'bg-amber-500';
    default: return 'bg-rose-500';
  }
};

export const buildPaymentTrackingUpdate = (project = {}, status = 'Not Updated', user = {}, paymentDetails = {}) => {
  const now = Date.now();
  const normalizedStatus = PAYMENT_TRACKING_OPTIONS.includes(status) ? status : 'Not Updated';
  const existingLedger = project.ledger || {};
  const estimateAmount = getPaymentEstimateAmount(project);
  const existingAmountIn = getPaymentReceivedAmount(project);
  const enteredAmount = paymentDetails.amountIn ?? paymentDetails.amount ?? paymentDetails.paymentAmountIn;
  const cleanedEnteredAmount = typeof enteredAmount === 'string' ? enteredAmount.replace(/[^0-9.-]/g, '') : enteredAmount;
  const enteredNumeric = Number(cleanedEnteredAmount);
  const today = new Date(now).toISOString().slice(0, 10);

  let nextLedger = {
    ...existingLedger,
    updatedAt: now,
    updatedBy: user?.name || 'Admin',
  };

  if (normalizedStatus === 'Paid') {
    const amountToSave = Number.isFinite(enteredNumeric) && enteredNumeric > 0 ? enteredNumeric : existingAmountIn;
    if (amountToSave <= 0) return project;
    nextLedger = {
      ...nextLedger,
      amountIn: amountToSave,
      date: paymentDetails.paymentDate || paymentDetails.date || existingLedger.date || today,
      mode: paymentDetails.mode || existingLedger.mode || '',
      receivedFrom: paymentDetails.receivedFrom || paymentDetails.payerName || existingLedger.receivedFrom || project.customerName || project.client || '',
      txnId: paymentDetails.txnId || paymentDetails.transactionId || existingLedger.txnId || '',
      status: amountToSave >= estimateAmount || estimateAmount <= 0 ? 'Paid' : 'Pending',
      paymentStatus: amountToSave >= estimateAmount || estimateAmount <= 0 ? 'Paid' : 'Pending',
      financeLedgerLinked: true,
    };
  } else {
    nextLedger = {
      ...nextLedger,
      status: normalizedStatus,
      paymentStatus: normalizedStatus,
    };
  }

  const draft = { ...project, ledger: nextLedger };
  const computedStatus = derivePaymentTrackingStatusFromData(draft);
  const previousStatus = getPaymentTrackingStatus(project);
  const nextAmountIn = getPaymentReceivedAmount(draft);
  const auditEvent = {
    id: `pay-${now}`,
    at: new Date(now).toISOString(),
    by: user?.name || 'Admin',
    action: 'Payment status updated',
    oldStatus: previousStatus,
    newStatus: computedStatus,
    oldAmount: existingAmountIn,
    newAmount: nextAmountIn,
    note: paymentDetails.note || (computedStatus === 'Paid'
      ? `Payment saved and ₹${Number(nextAmountIn || 0).toLocaleString('en-IN')} linked to Finance Ledger.`
      : `Payment status calculated as ${computedStatus}.`)
  };

  return {
    ...draft,
    paymentTrackingStatus: computedStatus,
    paymentTrackingUpdatedAt: now,
    paymentTrackingUpdatedBy: user?.name || 'Admin',
    paymentStatus: computedStatus === 'Paid' ? 'YES' : (computedStatus === 'Pending' ? 'PENDING' : 'NOT_UPDATED'),
    paymentReceived: computedStatus === 'Paid' ? 'YES' : (computedStatus === 'Pending' ? 'PARTIAL' : 'NO'),
    paymentAmountIn: nextAmountIn,
    paymentDate: nextLedger.date || project.paymentDate,
    paymentAuditTrail: [auditEvent, ...(project.paymentAuditTrail || [])],
    timeline: [
      ...(project.timeline || []),
      {
        id: now,
        text: computedStatus === 'Paid'
          ? `Payment saved by ${user?.name || 'Admin'} and ₹${Number(nextAmountIn || 0).toLocaleString('en-IN')} was added to Finance Ledger.`
          : `Payment status calculated as ${computedStatus} by ${user?.name || 'Admin'}.`,
        time: new Date(now).toLocaleString()
      }
    ]
  };
};
