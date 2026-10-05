import Decimal from 'decimal.js';

/** Isolated Decimal constructor: rounding mode is explicit and does not leak into other libraries. */
export const D = Decimal.clone({ precision: 28, rounding: Decimal.ROUND_HALF_UP });
export const MONEY_SCALE = 2;
export const toMoney = (v) => new D(v ?? 0).toDecimalPlaces(MONEY_SCALE, D.ROUND_HALF_UP);
export const moneyString = (d) => toMoney(d).toFixed(MONEY_SCALE);
