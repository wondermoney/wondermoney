import Flag from "react-flagkit";

export enum Exchanges {
  NASDAQ = "NASDAQ",
  NYSE = "NYSE",
  ETF = "ETF",
  MUTUAL_FUND = "MUTUAL_FUND",
  COMMODITY = "COMMODITY",
  INDEX = "INDEX",
  CRYPTO = "CRYPTO",
  FOREX = "FOREX",
  TSX = "TSX",
  AMEX = "AMEX",
  EURONEXT = "EURONEXT",
  LSE = "LSE",
  NSE = "NSE",
  XETRA = "XETRA",
}

const getExchangeFlag = (exchange: Exchanges) => {
  switch (exchange) {
    case Exchanges.NASDAQ:
      return <Flag country="US" size={20} />;
    case Exchanges.NYSE:
      return <Flag country="US" size={20} />;
    case Exchanges.TSX:
      return <Flag country="CA" size={20} />;
    case Exchanges.AMEX:
      return <Flag country="US" size={20} />;
    case Exchanges.EURONEXT:
      return <Flag country="NL" size={20} />;
    case Exchanges.LSE:
      return <Flag country="GB" size={20} />;
    case Exchanges.NSE:
      return <Flag country="IN" size={20} />;
    case Exchanges.XETRA:
      return <Flag country="DE" size={20} />;
    default:
      return undefined;
  }
};

export default getExchangeFlag;
