import montepioParser from './montepio';
import bcpParser from './bcp';
import bankinterParser from './bankinter';
import bpiParser from './bpi';
import activoBankParser from './activobank';

const getBankParser = (bank: string) => {
  switch (bank.toLowerCase()) {
    case 'montepio':
    case 'caixa economica montepio geral':
      return montepioParser;
    case 'bcp':
    case 'millennium bcp':
      return bcpParser;
    case 'bankinter':
      return bankinterParser;
    case 'bpi':
    case 'banco bpi':
      return bpiParser;
    case 'activobank':
    case 'banco activobank':
      return activoBankParser;
    default:
      throw new Error(`Invalid bank: ${bank}`);
  }
};

export default getBankParser;
