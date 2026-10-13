import coinbaseParser from './coinbase';
import degiroParser from './degiro';
import ikbrParser from './ibkr';
import trading212Parser from './trading212';

const getBrokerParser = (broker: string) => {
  switch (broker.toLowerCase()) {
    case 'degiro':
      return degiroParser;
    case 'ikbr':
      return ikbrParser;
    case 'trading212':
      return trading212Parser;
    case 'coinbase':
      return coinbaseParser;
    default:
      throw new Error(`Invalid broker: ${broker}`);
  }
};

export default getBrokerParser;
