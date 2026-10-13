import { Big } from 'big.js';

export function calculateMonthlyPrice(price: number | string, numberOfMonths: number | string, decimals = 2) {
  const x = new Big(price);
  const y = new Big(numberOfMonths);
  const monthlyPrice = x.div(y);
  return monthlyPrice.round(decimals);
}

export function calculateTotalPrice(priceWithoutTax: number | string, tax?: number | string, decimals = 2) {
  const x = new Big(priceWithoutTax); // 50
  const y = new Big(tax ?? 0); // 23
  const taxDecimal = y.div(100); // 0.23
  const taxValue = x.times(taxDecimal); // 50 * 0.23 = 11.5
  const total = x.plus(taxValue); // 50 + 11.5
  return total.round(decimals); // 61.50
}

export function mult100(num: number | string) {
  const x = new Big(num);
  const final = x.times(100);
  return final.toNumber();
}

export function round(originalNum: number | string, decimals = 2) {
  const x = new Big(originalNum);
  return x.toFixed(decimals);
}
