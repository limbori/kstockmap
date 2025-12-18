import FinanceDataReader as fdr
import pandas as pd
import yfinance as yf
import os
import datetime
from supabase import create_client, Client

# ==============================================================================
# [설정] Supabase 및 API 키 (로컬/서버 공용 설정)
# ==============================================================================
# 깃허브 액션 Secrets 혹은 OS 환경변수에서 값을 가져오고, 없으면 기본값을 사용합니다.
SUPABASE_URL = os.environ.get("SUPABASE_URL") or "https://nxzkhhfvlswyiekwonoq.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54emtoaGZ2bHN3eWlla3dvbm9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMjMwNzAsImV4cCI6MjA4MTU5OTA3MH0.9-n-mPE_glHDLKZTmCL26M0y0aEWEa31SWLvQycKQys"

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def get_yahoo_data(df_input):
    if df_input.empty: return df_input
    def convert_ticker(row):
        code = str(row['Code']).zfill(6)
        # 시장 구분에 따라 야후 티커 설정 (.KS 또는 .KQ)
        market = str(row.get('Market', ''))
        if 'KOSPI' in market: return f"{code}.KS"
        elif 'KOSDAQ' in market: return f"{code}.KQ"
        return f"{code}.KS"

    df_input['Yahoo_Code'] = df_input.apply(convert_ticker, axis=1)
    ticker_list = df_input['Yahoo_Code'].tolist()

    try:
        data = yf.download(ticker_list, period="5d", progress=False)['Close']
        if isinstance(data, pd.Series): data = data.to_frame()
        new_changes = []
        for yahoo_code in ticker_list:
            try:
                if yahoo_code in data.columns:
                    series = data[yahoo_code].dropna()
                    if len(series) >= 2:
                        today = series.iloc[-1]
                        yesterday = series.iloc[-2]
                        pct = (today - yesterday) / yesterday * 100
                        new_changes.append(pct)
                    else: new_changes.append(0.0)
                else: new_changes.append(0.0)
            except: new_changes.append(0.0)
        df_input['ChangesRatio'] = new_changes
        return df_input
    except: return df_input

def get_market_data(market_type):
    # 파일명 및 FDR 리스팅 설정
    if market_type == 'KOSPI200': 
        file_base, fdr_listing = 'my_sectors_kospi200', 'KOSPI' 
    else: 
        file_base, fdr_listing = 'my_sectors_kosdaq150', 'KOSDAQ'

    # 1. CSV 파일 읽기 (경로 설정 강화)
    csv_path = os.path.join(os.path.dirname(__file__), f'{file_base}.csv')
    if not os.path.exists(csv_path):
        print(f"❌ 파일을 찾을 수 없음: {csv_path}")
        return pd.DataFrame()

    try: 
        df_custom = pd.read_csv(csv_path, dtype={'종목코드': str}, encoding='utf-8')
    except: 
        df_custom = pd.read_csv(csv_path, dtype={'종목코드': str}, encoding='cp949')
    
    if df_custom.empty: return pd.DataFrame()

    # 종목코드 6자리 맞춤 및 중복 제거
    df_custom['종목코드'] = df_custom['종목코드'].str.strip().str.zfill(6)
    df_custom = df_custom.drop_duplicates(subset=['종목코드'])

    # 2. 실시간 시세 리스트 가져오기
    df_fdr = fdr.StockListing(fdr_listing)
    df_fdr['Code'] = df_fdr['Code'].str.zfill(6)

    # 3. [핵심] CSV에 있는 종목만 남기기 (inner merge)
    df_final = pd.merge(df_fdr, df_custom, left_on='Code', right_on='종목코드', how='inner')

    # 4. 시가총액 계산
    if 'Marcap' not in df_final.columns:
        for col in ['MarCap', 'MarketCap', 'Amount']:
            if col in df_final.columns:
                df_final['Marcap'] = df_final[col]
                break
    
    df_final['Marcap'] = pd.to_numeric(df_final['Marcap'], errors='coerce').fillna(0)
    df_final['시총_조'] = df_final['Marcap'] / 1_000_000_000_000
    
    # 5. 등락률 가져오기
    df_final = get_yahoo_data(df_final)
    df_final['내분류'] = df_final['내분류'].fillna('기타')
    
    return df_final

def update_to_supabase(df, market_label):
    if df.empty: return

    data_list = []
    for _, row in df.iterrows():
        data_list.append({
            "code": str(row['Code']),
            "name": str(row['Name']),
            "category": str(row['내분류']),
            "marcap": float(row['시총_조']),
            "change_ratio": float(row.get('ChangesRatio', 0.0)),
            "market": market_label
        })
    
    try:
        # 데이터 전송 (upsert)
        for i in range(0, len(data_list), 100):
            supabase.table("stocks").upsert(data_list[i:i+100]).execute()
        print(f"✅ {market_label} ({len(data_list)}개) 업데이트 완료!")
    except Exception as e:
        print(f"❌ {market_label} 오류: {e}")

if __name__ == "__main__":
    print(f"🚀 데이터 수집 시작: {datetime.datetime.now()}")
    
    # 1. 코스피 처리
    df_k200 = get_market_data('KOSPI200')
    update_to_supabase(df_k200, 'KOSPI200')
    
    # 2. 코스닥 처리
    df_k150 = get_market_data('KOSDAQ150')
    update_to_supabase(df_k150, 'KOSDAQ150')
    
    print("🏁 모든 데이터 전송 완료!")