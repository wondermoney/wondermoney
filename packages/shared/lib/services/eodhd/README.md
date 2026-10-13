# Eodhd

Thin wrapper around the official [`eodhd`](https://www.npmjs.com/package/eodhd) SDK, covering the endpoints WonderMoney actually uses: end-of-day prices, live quotes, dividends, splits, search, and the stock screener.

```ts
import Eodhd from '@wondermoney/shared/dist/services/eodhd';
// or, once re-exported from the package root:
import { Eodhd, EodhdError, EodhdTypes } from '@wondermoney/shared';

const client = new Eodhd({ apiKey: process.env.EODHD_API_KEY });
const prices = await client.getEndOfDayPrices('AAPL.US', { from: '2026-01-01' });
```

Errors are normalized to `EodhdError` (`message`, `code`, `status`, `original`, `retryAfter`) regardless of the underlying SDK error subclass.
