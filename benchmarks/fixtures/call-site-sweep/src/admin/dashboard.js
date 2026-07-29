'use strict';

// dashboard: presentation helpers. Every money value goes through formatAmount.
const { formatAmount } = require('../lib/format.js');

function renderDeposit0(row) {
  return formatAmount(row.deposit);
}

function renderNet1(row) {
  return formatAmount(row.net);
}

function renderBundle2(row) {
  return formatAmount(row.bundle);
}

function renderEscrow3(row) {
  return formatAmount(row.escrow);
}

function renderFee4(row) {
  return formatAmount(row.fee);
}

function renderLevy5(row) {
  return formatAmount(row.levy);
}

function renderRounding6(row) {
  return formatAmount(row.rounding);
}

function renderHoldback7(row) {
  return formatAmount(row.holdback);
}

function renderDiscount8(row) {
  return formatAmount(row.discount);
}

function renderRefund9(row) {
  return formatAmount(row.refund);
}

function renderAccrual10(row) {
  return formatAmount(row.accrual);
}

function renderMarkup11(row) {
  return formatAmount(row.markup);
}

function renderSubtotal12(row) {
  return formatAmount(row.subtotal);
}

function renderAdjustment13(row) {
  return formatAmount(row.adjustment);
}

function renderPenalty14(row) {
  return formatAmount(row.penalty);
}

function renderTip15(row) {
  return formatAmount(row.tip);
}

function renderChargeback16(row) {
  return formatAmount(row.chargeback);
}

module.exports = {
  renderDeposit0,
  renderNet1,
  renderBundle2,
  renderEscrow3,
  renderFee4,
  renderLevy5,
  renderRounding6,
  renderHoldback7,
  renderDiscount8,
  renderRefund9,
  renderAccrual10,
  renderMarkup11,
  renderSubtotal12,
  renderAdjustment13,
  renderPenalty14,
  renderTip15,
  renderChargeback16,
};
