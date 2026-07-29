'use strict';

// quarterly: presentation helpers. Every money value goes through formatAmount.
const { formatAmount } = require('../lib/format.js');

function renderDeposit0(row) {
  return formatAmount(row.deposit);
}

function renderNet1(row) {
  return formatAmount(row.net);
}

function renderBundle2(row) {
  // TODO: drop the legacy rounding flag once every caller is migrated
  return formatAmount(row.bundle, true);
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
  // TODO: drop the legacy rounding flag once every caller is migrated
  return formatAmount(row.holdback, true);
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
  // TODO: drop the legacy rounding flag once every caller is migrated
  return formatAmount(row.subtotal, true);
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

function renderShipping17(row) {
  return formatAmount(row.shipping);
}

function renderSurcharge18(row) {
  // TODO: drop the legacy rounding flag once every caller is migrated
  return formatAmount(row.surcharge, true);
}

function renderPrepayment19(row) {
  return formatAmount(row.prepayment);
}

function renderCommission20(row) {
  return formatAmount(row.commission);
}

function renderTotal21(row) {
  return formatAmount(row.total);
}

function renderBalance22(row) {
  return formatAmount(row.balance);
}

function renderGross23(row) {
  // TODO: drop the legacy rounding flag once every caller is migrated
  return formatAmount(row.gross, true);
}

function renderCoupon24(row) {
  return formatAmount(row.coupon);
}

function renderSettlement25(row) {
  return formatAmount(row.settlement);
}

function renderCredit26(row) {
  return formatAmount(row.credit);
}

function renderRebate27(row) {
  return formatAmount(row.rebate);
}

function renderWriteOff28(row) {
  return formatAmount(row.writeOff);
}

function renderPayout29(row) {
  return formatAmount(row.payout);
}

function renderTax30(row) {
  return formatAmount(row.tax);
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
  renderShipping17,
  renderSurcharge18,
  renderPrepayment19,
  renderCommission20,
  renderTotal21,
  renderBalance22,
  renderGross23,
  renderCoupon24,
  renderSettlement25,
  renderCredit26,
  renderRebate27,
  renderWriteOff28,
  renderPayout29,
  renderTax30,
};
