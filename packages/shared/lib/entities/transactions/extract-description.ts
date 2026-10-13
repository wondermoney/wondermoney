// For some reason I started doing the Regex so that the result would always be in the 2nd goup
// (index 1), so lets try to keep it that way for now
const transactionDescriptionRegex = {
  activobank: {
    card_payment: [
      /COMPRA (?:\d+) PAYPAL ([\w\s]+) (?:\d+) (?:\w+)/,
      /COMPRA (?:\d+) (.*)/,
    ],
    payment: [/PAG(?:.)? (.*)/, /PAG SERV (?:\d+\/\d+) (.*)/],
    transfer_out: [
      /TRF P\/ ([\w\s]+)/,
      /TRF P {2}([\w\s]+)/,
      /Ordem Pagamento s\/Estrangeiro {3}([\w\s.]+)/,
      /TRF (MB WAY P [\w\s]+)/,
    ],
    transfer_in: [
      /TRF (MB WAY DE [\w\s]+)/,
      /TRF\. P[/ ]O {1,2}([\w\s]+)/,
      /TRANSFERENCIA - (.*)/,
    ],
    payment_auto: [/DD (?:\w+) (.*) (?:\d+)/, /DD(?:\w+) (.*)/],
    fees: [/IMPOSTO(?: DO)? SELO/],
    deposit: [/DEPOSITO NUMERARIO {3}(.*)/],
  },
  bankinter: {
    card_payment: [/COMPRA (?:\d+.\d+) (.*)/],
    transfer_out: [/TRF. ATM (?:\d+) (.*)/, /TRF A CREDITO SEPA\+ - (.*)/], // Need to use the amount sign to differentiate
    transfer_in: [/TRF. ATM (?:\d+) (.*)/], // Need to use the amount sign to differentiate
    payment_auto: [/Cobranca (?:DD-\d+) (.*)/, /PAGAMENTO DE (.*)/],
    loan: [/EMPRESTIMO (.*)/],
  },
  bcp: {
    card_payment: [/COMPRA (?:\d+) (.*)/],
    transfer_out: [
      /TRF P\/ ([\w\s]+)/,
      /Ordem Pagamento s\/Estrangeiro {3}([\w\s.]+)/,
    ],
    transfer_in: [
      /TRF (?:[\w\s]+) DE ([\w\s]+)/,
      /TRANSF (.*)/,
      /TRANSFERENCIA - (.*)/,
    ],
    payment_auto: [/DD(?:\s?\w+) (.*)/],
    fees: [
      /COM\.MAN\.CONTA (.*)/,
      /(COMISSAO TRF MBWAY) (?:.*)/,
      /IMPOSTO(?: DO)? SELO/,
      // /JUR DEVEDORES (\d+) A (\d+)/,
    ],
    deposit: [/DEPOSITO NUMERARIO {3}(.*)/],
    withdrawal: [/LEV ATM (?:\d+) (?:\w+)(?:\s+)(.*)/],
  },
  bpi: {
    card_payment: [/(?:.*\/.*) COMPRA ELEC (?:\d+\/\d+) (.*)/],
    transfer_in: [
      /TRF CR (?:\w|.+) (?:\d+) DE (.*)/,
      /(MOBILIZACAO DEPOSITO A PRAZO) (?:.*)/,
    ],
    transfer_out: [
      /TRF CR (?:\w|.+) (?:\d+) P\/ (.*)/,
      /(?:.*\/.*) TRF CRED SEPA\+ ELEC (?:\d+\/\d+) (.*)/,
    ],
    payment_auto: [/COBR SEPA (?:\w+|\d+) (.*)/],
    payment: [/(?:.*\/.*) (PAG. SERV. ATM (?:.*))/],
    fees: [/(IMPOSTO DE SELO) (?:.*)/, /COMISSAO (MANUTENCAO .*)/],
  },
  montepio: {
    card_payment: [/COMPRA {3}(.*)/],
    transfer_in: [/TR-(.*)/, /TRF\.CRED (.*)/, /TRF\.DE (.*)/],
    transfer_out: [/TRANSF\.P\/(.*)/, /TRF\. {5}(.*)/, /TRF\. P\/ (.*)/],
    fees: [/MGAM QUOTAS(.*)/, /COM. (.*)/],
    revert: [/ANUL\.CPR (.*)/],
    payment: [/(PAG\.SERV\. (?:.*))/],
  },
};

const transactionTypes = {
  card_payment: 'CARD_PAYMENT',
  transfer_out: 'TRANSFER',
  transfer_in: 'TRANSFER',
  payment_auto: 'PAYMENT',
  payment: 'PAYMENT',
  fees: 'FEES',
  deposit: 'DEPOSIT',
  withdrawal: 'ATM',
  loan: 'LOAN',
  revert: 'REVERT',
};

export const extractDataFromTransactionDescription = (
  bank: string,
  transactionDescription: string
): {
  description: string;
  merchant: string;
  type: string;
  detected: boolean;
} => {
  const bankRegex =
    transactionDescriptionRegex[
      bank as keyof typeof transactionDescriptionRegex
    ];
  if (!bankRegex)
    return {
      description: transactionDescription,
      merchant: transactionDescription,
      type: 'PAYMENT',
      detected: false,
    };
  // exec all regexes for the bank and return the first group
  for (const [type, regexGroup] of Object.entries(bankRegex)) {
    for (const regex of regexGroup) {
      const match = regex.exec(transactionDescription);
      if (match) {
        const matchWithoutStuff = (match[1] ?? match[0])
          .replace(/  +/g, ' ')
          .replace('CONTACTLESS', '');
        return {
          merchant: matchWithoutStuff,
          description: matchWithoutStuff,
          type: transactionTypes[type as keyof typeof transactionTypes],
          detected: true,
        };
      }
    }
  }
  // fallback
  return {
    merchant: transactionDescription,
    description: transactionDescription,
    type: 'PAYMENT',
    detected: false,
  };
};
