export const PAYMENT_TRACKING_OPTIONS = ['Not Updated', 'Pending', 'Paid'];

const normalizePaymentValue = (value = '') => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export const getPaymentTrackingStatus = (project = {}) => {
  const explicit = String(project.paymentTrackingStatus || project.paymentTrackStatus || '').trim();
  if (explicit) {
    const normalizedExplicit = PAYMENT_TRACKING_OPTIONS.find(option => normalizePaymentValue(option) === normalizePaymentValue(explicit));
    if (normalizedExplicit) return normalizedExplicit;
  }

  const ledger = project.ledger || {};
  const amountIn = Number(ledger.amountIn ?? project.paymentAmountIn ?? 0) || 0;
  const estimate = Number(project.estimate ?? project.estimateAmount ?? 0) || 0;
  const hasLedgerUpdate = Boolean(ledger.updatedAt || project.paymentTrackingUpdatedAt || project.paymentDate || project.paymentTime || amountIn > 0);
  const legacyStatus = normalizePaymentValue(project.paymentStatus || project.paymentReceived || ledger.status || '');

  if (legacyStatus === 'PAID' || legacyStatus === 'RECEIVED' || legacyStatus === 'YES') return 'Paid';
  if (legacyStatus === 'PARTIAL' || legacyStatus === 'REFUND') return 'Pending';
  if (amountIn > 0 && estimate > 0 && amountIn >= estimate) return 'Paid';
  if (amountIn > 0 || (hasLedgerUpdate && legacyStatus === 'PENDING')) return 'Pending';
  return 'Not Updated';
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

export const getPaymentEstimateAmount = (project = {}) => {
  const raw = project.estimate ?? project.estimateAmount ?? project.amount ?? project.totalAmount ?? project.ledger?.expectedAmount ?? 0;
  const cleaned = typeof raw === 'string' ? raw.replace(/[^0-9.-]/g, '') : raw;
  return Math.max(0, Number(cleaned) || 0);
};

export const buildPaymentTrackingUpdate = (project = {}, status = 'Not Updated', user = {}) => {
  const now = Date.now();
  const normalizedStatus = PAYMENT_TRACKING_OPTIONS.includes(status) ? status : 'Not Updated';
  const estimateAmount = getPaymentEstimateAmount(project);
  const existingLedger = project.ledger || {};
  const existingAmountIn = Number(existingLedger.amountIn ?? 0) || 0;
  const paidAmount = normalizedStatus === 'Paid' ? (estimateAmount || existingAmountIn) : existingAmountIn;
  const today = new Date(now).toISOString().slice(0, 10);
  const ledgerUpdate = {
    ...existingLedger,
    status: normalizedStatus,
    paymentStatus: normalizedStatus,
    updatedAt: now,
    updatedBy: user?.name || 'Admin',
  };

  if (normalizedStatus === 'Paid') {
    ledgerUpdate.amountIn = paidAmount;
    ledgerUpdate.date = existingLedger.date || today;
    ledgerUpdate.receivedFrom = existingLedger.receivedFrom || project.customerName || project.client || 'Auto-filled from payment status';
    ledgerUpdate.autoFilledFromPaymentStatus = true;
  }

  return {
    ...project,
    paymentTrackingStatus: normalizedStatus,
    paymentTrackingUpdatedAt: now,
    paymentTrackingUpdatedBy: user?.name || 'Admin',
    paymentAmountIn: normalizedStatus === 'Paid' ? paidAmount : project.paymentAmountIn,
    ledger: ledgerUpdate,
    timeline: [
      ...(project.timeline || []),
      {
        id: now,
        text: normalizedStatus === 'Paid'
          ? `Payment marked Paid by ${user?.name || 'Admin'} and ₹${Number(paidAmount || 0).toLocaleString('en-IN')} was added to Finance Ledger.`
          : `Payment status marked ${normalizedStatus} by ${user?.name || 'Admin'}.`,
        time: new Date(now).toLocaleString()
      }
    ]
  };
};

