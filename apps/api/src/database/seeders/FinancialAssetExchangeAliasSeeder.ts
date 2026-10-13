// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { EntityManager } from '@mikro-orm/core';

import { FinancialAssetExchangeAlias } from '@entity/FinancialAssetExchangeAlias';
import { Seeder } from '@mikro-orm/seeder';

export class FinancialAssetExchangeAliasSeeder extends Seeder {
  async run(em: EntityManager): Promise<void> {
    // NYSE
    em.create(FinancialAssetExchangeAlias, {
      name: 'UA',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'UN',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'UP',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'US',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'XNYS',
    });
    // NASDAQ
    em.create(FinancialAssetExchangeAlias, {
      name: 'UQ',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'UR',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'UW',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'XNMS',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'XNCM',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'XNGS',
    });
    // em.create(FinancialAssetExchangeAlias, {
    //   name: 'US',
    // });
    // XAMS
    em.create(FinancialAssetExchangeAlias, {
      name: 'AMS',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'AS',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'NA',
    });
    // XBRU
    em.create(FinancialAssetExchangeAlias, {
      name: 'EBR',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'BR',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'BB',
    });
    // XLIS
    em.create(FinancialAssetExchangeAlias, {
      name: 'ELI',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'LS',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'PL',
    });
    // XPAR
    em.create(FinancialAssetExchangeAlias, {
      name: 'EPA',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'PA',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'FP',
    });
    // XMSM
    em.create(FinancialAssetExchangeAlias, {
      name: 'EDP',
    });
    // XMIL
    em.create(FinancialAssetExchangeAlias, {
      name: 'MIL',
    });
    // XOSL
    em.create(FinancialAssetExchangeAlias, {
      name: 'OSL',
    });
    // TSX
    em.create(FinancialAssetExchangeAlias, {
      name: 'XTSX',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'V',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'CV',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'CN',
    });
    // SSE
    em.create(FinancialAssetExchangeAlias, {
      name: 'XSHG',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'SHA',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'SHG',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'CG',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'CH',
    });
    // SHE
    em.create(FinancialAssetExchangeAlias, {
      name: 'XSHE',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'CS',
    });
    // em.create(FinancialAssetExchangeAlias, {
    //   name: 'CH',
    // });
    // JPX
    em.create(FinancialAssetExchangeAlias, {
      name: 'XTKS',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'JP',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'JT',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'TYO',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'TSE',
    });
    // HKG
    em.create(FinancialAssetExchangeAlias, {
      name: 'XHKG',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'HK',
    });
    // BOM
    em.create(FinancialAssetExchangeAlias, {
      name: 'XBOM',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'IB',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'IN',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'BSE',
    });
    // NSE
    em.create(FinancialAssetExchangeAlias, {
      name: 'IS',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'XNSE',
    });
    // em.create(FinancialAssetExchangeAlias, {
    //   name: 'IN',
    // });
    // LON
    em.create(FinancialAssetExchangeAlias, {
      name: 'LI',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'XLON',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'LN',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'IL',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'LSE',
    });
    // SAU
    em.create(FinancialAssetExchangeAlias, {
      name: 'XSAU',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'AB',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'SR',
    });
    // SWX
    em.create(FinancialAssetExchangeAlias, {
      name: 'XSWX',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'SW',
    });
    em.create(FinancialAssetExchangeAlias, {
      name: 'SE',
    });
    // XMIL
    em.create(FinancialAssetExchangeAlias, {
      name: 'BVME',
    });
  }
}
