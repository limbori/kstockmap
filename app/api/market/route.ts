import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // 1. 야후 파이낸스 v8 차트 API 사용 (v7 quote보다 차단이 덜함)
    // ^KS11: 코스피, ^KQ11: 코스닥, KRW=X: 환율
    const symbols = ['^KS11', '^KQ11', 'KRW=X'];
    
    // 데이터 담을 그릇
    const marketData = {
      kospi: { price: 0, change: 0 },
      kosdaq: { price: 0, change: 0 },
      usd: { price: 0, change: 0 }
    };

    // 2. 병렬로 요청 보내기 (속도 향상)
    await Promise.all(symbols.map(async (symbol) => {
      try {
        // v8 endpoint 사용
        const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Origin': 'https://finance.yahoo.com',
            'Referer': 'https://finance.yahoo.com/'
          },
          next: { revalidate: 30 } // 30초 캐싱
        });

        const json = await response.json();
        const result = json.chart.result[0];
        const meta = result.meta;

        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose;
        const changePercent = ((price - prevClose) / prevClose) * 100;

        if (symbol === '^KS11') {
          marketData.kospi = { price, change: changePercent };
        } else if (symbol === '^KQ11') {
          marketData.kosdaq = { price, change: changePercent };
        } else if (symbol === 'KRW=X') {
          marketData.usd = { price, change: changePercent };
        }
      } catch (innerError) {
        console.error(`Failed to fetch ${symbol}:`, innerError);
      }
    }));

    return NextResponse.json(marketData);

  } catch (error) {
    console.error('Market API Error:', error);
    return NextResponse.json({
      kospi: { price: 0, change: 0 },
      kosdaq: { price: 0, change: 0 },
      usd: { price: 0, change: 0 },
    });
  }
}