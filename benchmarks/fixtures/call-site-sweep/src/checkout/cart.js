'use strict';

// cart: presentation helpers. Every money value goes through formatAmount.
const { formatAmount } = require('../lib/format.js');

function renderShipping0(row) {
  return formatAmount(row.shipping);
}

function renderSurcharge1(row) {
  return formatAmount(row.surcharge);
}

function renderPrepayment2(row) {
  // TODO: drop the legacy rounding flag once every caller is migrated
  return formatAmount(row.prepayment, true);
}

function renderCommission3(row) {
  return formatAmount(row.commission);
}

function renderTotal4(row) {
  return formatAmount(row.total);
}

function renderBalance5(row) {
  return formatAmount(row.balance);
}

function renderGross6(row) {
  return formatAmount(row.gross);
}

function renderCoupon7(row) {
  return formatAmount(row.coupon);
}

function renderSettlement8(row) {
  return formatAmount(row.settlement);
}

function renderCredit9(row) {
  return formatAmount(row.credit);
}

function renderRebate10(row) {
  return formatAmount(row.rebate);
}

function renderWriteOff11(row) {
  // TODO: drop the legacy rounding flag once every caller is migrated
  return formatAmount(row.writeOff, true);
}

function renderPayout12(row) {
  return formatAmount(row.payout);
}

function renderTax13(row) {
  return formatAmount(row.tax);
}

function renderDeposit14(row) {
  return formatAmount(row.deposit);
}

function renderNet15(row) {
  return formatAmount(row.net);
}

function renderBundle16(row) {
  return formatAmount(row.bundle);
}

function renderEscrow17(row) {
  return formatAmount(row.escrow);
}

function renderFee18(row) {
  return formatAmount(row.fee);
}

function renderLevy19(row) {
  return formatAmount(row.levy);
}

function renderRounding20(row) {
  return formatAmount(row.rounding);
}

function renderHoldback21(row) {
  return formatAmount(row.holdback);
}

function renderDiscount22(row) {
  return formatAmount(row.discount);
}

module.exports = {
  renderShipping0,
  renderSurcharge1,
  renderPrepayment2,
  renderCommission3,
  renderTotal4,
  renderBalance5,
  renderGross6,
  renderCoupon7,
  renderSettlement8,
  renderCredit9,
  renderRebate10,
  renderWriteOff11,
  renderPayout12,
  renderTax13,
  renderDeposit14,
  renderNet15,
  renderBundle16,
  renderEscrow17,
  renderFee18,
  renderLevy19,
  renderRounding20,
  renderHoldback21,
  renderDiscount22,
};
