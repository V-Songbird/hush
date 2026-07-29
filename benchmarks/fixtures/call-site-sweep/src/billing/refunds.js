'use strict';

// refunds: presentation helpers. Every money value goes through formatAmount.
const { formatAmount } = require('../lib/format.js');

function renderAdjustment0(row) {
  return formatAmount(row.adjustment);
}

function renderPenalty1(row) {
  return formatAmount(row.penalty);
}

function renderTip2(row) {
  return formatAmount(row.tip);
}

function renderChargeback3(row) {
  return formatAmount(row.chargeback);
}

function renderShipping4(row) {
  return formatAmount(row.shipping);
}

function renderSurcharge5(row) {
  return formatAmount(row.surcharge);
}

function renderPrepayment6(row) {
  return formatAmount(row.prepayment);
}

function renderCommission7(row) {
  return formatAmount(row.commission);
}

function renderTotal8(row) {
  return formatAmount(row.total);
}

function renderBalance9(row) {
  return formatAmount(row.balance);
}

function renderGross10(row) {
  return formatAmount(row.gross);
}

function renderCoupon11(row) {
  return formatAmount(row.coupon);
}

function renderSettlement12(row) {
  return formatAmount(row.settlement);
}

function renderCredit13(row) {
  return formatAmount(row.credit);
}

function renderRebate14(row) {
  return formatAmount(row.rebate);
}

function renderWriteOff15(row) {
  return formatAmount(row.writeOff);
}

function renderPayout16(row) {
  return formatAmount(row.payout);
}

function renderTax17(row) {
  return formatAmount(row.tax);
}

function renderDeposit18(row) {
  return formatAmount(row.deposit);
}

module.exports = {
  renderAdjustment0,
  renderPenalty1,
  renderTip2,
  renderChargeback3,
  renderShipping4,
  renderSurcharge5,
  renderPrepayment6,
  renderCommission7,
  renderTotal8,
  renderBalance9,
  renderGross10,
  renderCoupon11,
  renderSettlement12,
  renderCredit13,
  renderRebate14,
  renderWriteOff15,
  renderPayout16,
  renderTax17,
  renderDeposit18,
};
