import * as jsvat from 'jsvat-next';

import type { ISO3166_1_ALPHA_2 } from '@app/types/iso3166-1-alpha-2';

type JsvatModule = typeof jsvat;

const jsvatDefault = 'default' in jsvat ? (jsvat as JsvatModule & { default: JsvatModule }).default : undefined;
const jsvatExports = jsvatDefault ?? jsvat;
const { checkVAT, europe, portugal, spain } = jsvatExports;

export const checkIfVATIsValid = (
  value: string,
  country: ISO3166_1_ALPHA_2,
): { isValid: boolean; value: string | undefined } => {
  // Doing sanitization for now for portuguese and spanish VAT numbers only
  let sanitizedValue = value;
  if (country === 'PT' && value.length < 11 && !value.startsWith('PT')) {
    sanitizedValue = `PT${value}`;
  } else if (country === 'ES' && value.length < 10 && !value.startsWith('ES')) {
    sanitizedValue = `ES${value}`;
  }

  const VATConfirmation = checkVAT(sanitizedValue, [portugal, spain, europe]);
  if (VATConfirmation.isValid) return { isValid: true, value: VATConfirmation.value };

  return { isValid: false, value: undefined };
};

export const stripPTPrefixFromVAT = (vat: string) => {
  if (!vat.startsWith('PT')) return vat;

  return vat.split('PT')[1];
};
