import { demoAccounts } from '@app/database/seeders/demo/demo-fixtures';
import { demoPortfolios } from '@app/database/seeders/demo/demo-portfolio';

export const DEMO_BANK_TRANSACTION_ID_PREFIX = 'DEMO-BANK-TXN-';
export const DEMO_PORTFOLIO_TRANSACTION_ID_PREFIX = 'DEMO-PORTFOLIO-TXN-';
export const DEMO_PORTFOLIO_SNAPSHOT_ID_PREFIX = 'DEMO-PORTFOLIO-SNAPSHOT-';

export type DemoBankAccountName = (typeof demoAccounts)[keyof typeof demoAccounts]['accountName'];
export interface DemoBankTransactionFixture {
  accountName: DemoBankAccountName;
  amount: number;
  description: string;
  descriptionDirty: string;
  externalTransactionId: string;
  merchant: string;
  offsetDays: number;
  type: DemoBankTransactionType;
}

export type DemoBankTransactionType = 'DEPOSIT' | 'PAYMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT';

export type DemoPortfolioName = (typeof demoPortfolios)[number]['name'];
export type DemoPortfolioSymbol = 'AAPL' | 'CRM' | 'CURRENCY_EUR' | 'CURRENCY_USD' | 'GOOGL' | 'INTC' | 'NVDA' | 'TXN';
export interface DemoPortfolioTransactionFixture {
  externalTransactionId: string;
  feeAmount: number;
  offsetDays: number;
  portfolioName: DemoPortfolioName;
  quantity: number;
  settlementAmount: number;
  symbol: DemoPortfolioSymbol;
  type: DemoPortfolioTransactionType;
}

export type DemoPortfolioTransactionType = 'BUY' | 'DEPOSIT' | 'DIVIDEND' | 'SELL' | 'WITHDRAWAL';

export const demoBankTransactionFixtures: DemoBankTransactionFixture[] = [
  {
    accountName: demoAccounts.current.accountName,
    amount: 2000,
    description: 'Vencimento Acme Consulting',
    descriptionDirty: 'Transf. Vencimento Acme Consulting',
    externalTransactionId: `${DEMO_BANK_TRANSACTION_ID_PREFIX}SALARY-00`,
    merchant: 'Acme Consulting',
    offsetDays: 0,
    // A salary is income, not a transfer.
    type: 'DEPOSIT',
  },
  {
    accountName: demoAccounts.current.accountName,
    amount: -600,
    description: 'Pag Empréstimo Hipoteca',
    descriptionDirty: 'PAG. EMPRESTIMO HIPOT. N. 1914621903',
    externalTransactionId: `${DEMO_BANK_TRANSACTION_ID_PREFIX}MORTGAGE-00`,
    merchant: 'Pag Empréstimo Hipoteca',
    offsetDays: 1,
    type: 'PAYMENT',
  },
  ...(
    [
      {
        amount: -168.4,
        description: 'Continente',
        descriptionDirty: 'COMPRA 1192 CONTINENTE SANTA MARINH CONTACTLESS',
        key: 'GROCERIES-CONTINENTE-LARGE',
        merchant: 'Continente',
      },
      {
        amount: -21.2,
        description: 'Churrasqueira da Zona',
        descriptionDirty: 'COMPRA 1192 Churrasqueira da Zona',
        key: 'DINING-CHURRASQUEIRA',
        merchant: 'Churrasqueira da Zona',
      },
      {
        amount: -34.8,
        description: 'Pingo Doce',
        descriptionDirty: 'COMPRA 1192 Pingo Doce PORTO CONTACTLESS',
        key: 'GROCERIES-PINGO-DOCE',
        merchant: 'Pingo Doce',
      },
      {
        amount: -42.5,
        description: 'Galp',
        descriptionDirty: 'COMPRA 1192 Galp Posto Boavista PORTO',
        key: 'FUEL-GALP',
        merchant: 'Galp',
      },
      {
        amount: -16.5,
        description: 'Cinema NOS',
        descriptionDirty: 'COMPRA 1192 Cinema NOS CONTACTLESS',
        key: 'LEISURE-CINEMA-NOS',
        merchant: 'Cinema NOS',
      },
      {
        amount: -4.1,
        description: 'Café do Bairro',
        descriptionDirty: 'COMPRA 1192 Café do Bairro CONTACTLESS',
        key: 'CAFE-BAIRRO-01',
        merchant: 'Café do Bairro',
      },
      {
        amount: -84.9,
        description: 'Worten',
        descriptionDirty: 'COMPRA 1192 Worten Gaia CONTACTLESS',
        key: 'LEISURE-WORTEN',
        merchant: 'Worten',
      },
      {
        amount: -13.99,
        description: 'Netflix',
        descriptionDirty: 'COMPRA 1192 Netflix',
        key: 'SUBSCRIPTION-NETFLIX',
        merchant: 'Netflix',
      },
      {
        amount: -46.2,
        description: 'EDP Comercial',
        descriptionDirty: 'DD PT22883372 EDP COMERCIAL-C 12394782',
        key: 'UTILITY-EDP',
        merchant: 'EDP Comercial',
      },
      {
        amount: -24.1,
        description: 'Águas de Gaia',
        descriptionDirty: 'DD PT912378 Águas de Gaia-C 092183',
        key: 'UTILITY-WATER',
        merchant: 'Águas de Gaia',
      },
      {
        amount: -11.7,
        description: 'Glovo',
        descriptionDirty: 'COMPRA 1192 Glovo',
        key: 'FOOD-GLOVO-01',
        merchant: 'Glovo',
      },
      {
        amount: -15.5,
        description: 'Bar da Praia',
        descriptionDirty: 'COMPRA 1192 Bar da Praia CONTACTLESS',
        key: 'DINING-BAR-PRAIA',
        merchant: 'Bar da Praia',
      },
      {
        amount: -35,
        description: 'MEO',
        descriptionDirty: 'DD PT09832173 MEO, SA 89213987231',
        key: 'UTILITY-MEO',
        merchant: 'MEO',
      },
      {
        amount: -45.3,
        description: 'Restaurante de Cima',
        descriptionDirty: 'COMPRA 1192 Restaurante de Cima',
        key: 'DINING-RESTAURANTE-CIMA',
        merchant: 'Restaurante de Cima',
      },
      {
        amount: -8.12,
        description: 'PayPal Pedro',
        descriptionDirty: 'PayPal Pedro Silva EUR 8.12',
        key: 'GIFT-PAYPAL-PEDRO',
        merchant: 'PayPal Pedro',
      },
      {
        amount: -3.6,
        description: 'Café do Bairro',
        descriptionDirty: 'COMPRA 1192 Café do Bairro CONTACTLESS',
        key: 'CAFE-BAIRRO-02',
        merchant: 'Café do Bairro',
      },
      {
        amount: -72.4,
        description: 'Continente',
        descriptionDirty: 'COMPRA 1192 CONTINENTE SANTA MARINH CONTACTLESS',
        key: 'GROCERIES-CONTINENTE-MEDIUM',
        merchant: 'Continente',
      },
      {
        amount: -27.6,
        description: 'Pingo Doce',
        descriptionDirty: 'COMPRA 1192 Pingo Doce PORTO CONTACTLESS',
        key: 'GROCERIES-PINGO-DOCE-SMALL',
        merchant: 'Pingo Doce',
      },
      {
        amount: -9.2,
        description: 'Glovo',
        descriptionDirty: 'COMPRA 1192 Glovo',
        key: 'FOOD-GLOVO-02',
        merchant: 'Glovo',
      },
      {
        amount: -38.9,
        description: 'Galp',
        descriptionDirty: 'COMPRA 1192 Galp Posto Boavista PORTO',
        key: 'FUEL-GALP-SECOND',
        merchant: 'Galp',
      },
      {
        amount: 15,
        description: 'Trf Mb Way de Tiago',
        descriptionDirty: 'TRF. MB WAY DE TIAGO 12897312',
        key: 'TRANSFER-IN-TIAGO',
        merchant: 'Mb Way Tiago',
      },
    ] satisfies { amount: number; description: string; descriptionDirty: string; key: string; merchant: string }[]
  ).map(
    ({ amount, description, descriptionDirty, key, merchant }, index): DemoBankTransactionFixture => ({
      accountName: demoAccounts.current.accountName,
      amount,
      description,
      descriptionDirty,
      externalTransactionId: `${DEMO_BANK_TRANSACTION_ID_PREFIX}${key}`,
      merchant,
      offsetDays: index + 2,
      type: amount > 0 ? 'DEPOSIT' : 'PAYMENT',
    }),
  ),
  {
    accountName: demoAccounts.savings.accountName,
    amount: -500,
    description: 'Transfer to Emergency Fund',
    descriptionDirty: 'TRF. POUPANCA FUNDO EMERGENCIA',
    externalTransactionId: `${DEMO_BANK_TRANSACTION_ID_PREFIX}SAVINGS-TRANSFER-00`,
    merchant: 'Mb Way Joana',
    offsetDays: 29,
    type: 'TRANSFER_OUT' as const,
  },
  {
    accountName: demoAccounts.usd.accountName,
    amount: -45,
    description: 'USD card purchase',
    descriptionDirty: 'CARD PURCHASE USD SERVICES',
    externalTransactionId: `${DEMO_BANK_TRANSACTION_ID_PREFIX}USD-CARD-00`,
    merchant: 'PayPal Pedro',
    offsetDays: 30,
    type: 'PAYMENT' as const,
  },
];

export const demoPortfolioTransactionFixtures: DemoPortfolioTransactionFixture[] = [
  {
    externalTransactionId: `${DEMO_PORTFOLIO_TRANSACTION_ID_PREFIX}LONG-TERM-DEPOSIT-00`,
    feeAmount: 0,
    offsetDays: 28,
    portfolioName: 'Long-term investments',
    quantity: 1,
    settlementAmount: 750,
    symbol: 'CURRENCY_EUR',
    type: 'DEPOSIT',
  },
  {
    externalTransactionId: `${DEMO_PORTFOLIO_TRANSACTION_ID_PREFIX}LONG-TERM-AAPL-BUY-00`,
    feeAmount: 1.2,
    offsetDays: 24,
    portfolioName: 'Long-term investments',
    quantity: 2,
    settlementAmount: 240,
    symbol: 'AAPL',
    type: 'BUY',
  },
  {
    externalTransactionId: `${DEMO_PORTFOLIO_TRANSACTION_ID_PREFIX}LONG-TERM-NVDA-BUY-00`,
    feeAmount: 2.1,
    offsetDays: 18,
    portfolioName: 'Long-term investments',
    quantity: 3,
    settlementAmount: 420,
    symbol: 'NVDA',
    type: 'BUY',
  },
  {
    externalTransactionId: `${DEMO_PORTFOLIO_TRANSACTION_ID_PREFIX}SHORT-TERM-DEPOSIT-00`,
    feeAmount: 0,
    offsetDays: 15,
    portfolioName: 'Short-term opportunities',
    quantity: 1,
    settlementAmount: 500,
    symbol: 'CURRENCY_EUR',
    type: 'DEPOSIT',
  },
  {
    externalTransactionId: `${DEMO_PORTFOLIO_TRANSACTION_ID_PREFIX}SHORT-TERM-CRM-BUY-00`,
    feeAmount: 1.4,
    offsetDays: 12,
    portfolioName: 'Short-term opportunities',
    quantity: 2,
    settlementAmount: 220,
    symbol: 'CRM',
    type: 'BUY',
  },
  {
    externalTransactionId: `${DEMO_PORTFOLIO_TRANSACTION_ID_PREFIX}US-GROWTH-DEPOSIT-00`,
    feeAmount: 0,
    offsetDays: 10,
    portfolioName: 'US growth portfolio',
    quantity: 1,
    settlementAmount: 650,
    symbol: 'CURRENCY_USD',
    type: 'DEPOSIT',
  },
  {
    externalTransactionId: `${DEMO_PORTFOLIO_TRANSACTION_ID_PREFIX}US-GROWTH-GOOGL-BUY-00`,
    feeAmount: 2.3,
    offsetDays: 7,
    portfolioName: 'US growth portfolio',
    quantity: 4,
    settlementAmount: 360,
    symbol: 'GOOGL',
    type: 'BUY',
  },
  {
    externalTransactionId: `${DEMO_PORTFOLIO_TRANSACTION_ID_PREFIX}LONG-TERM-AAPL-DIVIDEND-00`,
    feeAmount: 0,
    offsetDays: 2,
    portfolioName: 'Long-term investments',
    quantity: 2,
    settlementAmount: 0.84,
    symbol: 'AAPL',
    type: 'DIVIDEND',
  },
];
