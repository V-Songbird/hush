'use strict';

// ledger: presentation helpers. Every money value goes through formatAmount.
const { formatAmount } = require('../lib/format.js');

function renderFee0(row) {
  return formatAmount(row.fee);
}

function renderLevy1(row) {
  return formatAmount(row.levy);
}

function renderRounding2(row) {
  return formatAmount(row.rounding);
}

function renderHoldback3(row) {
  return formatAmount(row.holdback);
}

function renderDiscount4(row) {
  return formatAmount(row.discount);
}

function renderRefund5(row) {
  return formatAmount(row.refund);
}

function renderAccrual6(row) {
  return formatAmount(row.accrual);
}

function renderMarkup7(row) {
  return formatAmount(row.markup);
}

function renderSubtotal8(row) {
  return formatAmount(row.subtotal);
}

function renderAdjustment9(row) {
  return formatAmount(row.adjustment);
}

function renderPenalty10(row) {
  return formatAmount(row.penalty);
}

function renderTip11(row) {
  return formatAmount(row.tip);
}

function renderChargeback12(row) {
  return formatAmount(row.chargeback);
}

function renderShipping13(row) {
  return formatAmount(row.shipping);
}

function renderSurcharge14(row) {
  return formatAmount(row.surcharge);
}

function renderPrepayment15(row) {
  return formatAmount(row.prepayment);
}

function renderCommission16(row) {
  return formatAmount(row.commission);
}

function renderTotal17(row) {
  return formatAmount(row.total);
}

function renderBalance18(row) {
  return formatAmount(row.balance);
}

function renderGross19(row) {
  return formatAmount(row.gross);
}

module.exports = {
  renderFee0,
  renderLevy1,
  renderRounding2,
  renderHoldback3,
  renderDiscount4,
  renderRefund5,
  renderAccrual6,
  renderMarkup7,
  renderSubtotal8,
  renderAdjustment9,
  renderPenalty10,
  renderTip11,
  renderChargeback12,
  renderShipping13,
  renderSurcharge14,
  renderPrepayment15,
  renderCommission16,
  renderTotal17,
  renderBalance18,
  renderGross19,
};
