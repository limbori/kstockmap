'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Clock, MessageSquare, TrendingUp, TrendingDown, ThumbsUp, ThumbsDown, RefreshCcw } from 'lucide-react';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// [트리맵 알고리즘]
function recurseSquarify(data: any[], x: number, y: number, w: number, h: number): any[] {
  if (data.length === 0) return [];
  const totalValue = data.reduce((acc, item) => acc + item.value, 0);
  const ratio = (w * h) / totalValue;
  const scaledData = data.map(d => ({ ...d, value: d.value * ratio }));
  let results: any[] = [];
  let row: any[] = [];
  let rect = { x, y, w, h };
  function getShortestSide() { return Math.min(rect.w, rect.h); }
  function worstRatio(row: any[], width: number) {
    if (row.length === 0) return Infinity;
    const sum = row.reduce((s, d) => s + d.value, 0);
    const maxVal = Math.max(...row.map(d => d.value));
    const minVal = Math.min(...row.map(d => d.value));
    return Math.max((width * width * maxVal) / (sum * sum), (sum * sum) / (width * width * minVal));
  }
  function layoutRow(row: any[]) {
    const rowSum = row.reduce((s, d) => s + d.value, 0);
    const side = getShortestSide();
    const thickness = rowSum / side;
    let currentX = rect.x;
    let currentY = rect.y;
    if (rect.w < rect.h) { 
      row.forEach(item => {
        const itemW = (item.value / rowSum) * rect.w;
        results.push({ ...item, x: currentX, y: currentY, w: itemW, h: thickness });
        currentX += itemW;
      });
      rect.y += thickness;
      rect.h -= thickness;
    } else {
      row.forEach(item => {
        const itemH = (item.value / rowSum) * rect.h;
        results.push({ ...item, x: currentX, y: currentY, w: thickness, h: itemH });
        currentY += itemH;
      });
      rect.x += thickness;
      rect.w -= thickness;
    }
  }
  for (const item of scaledData) {
    if (row.length === 0) { row.push(item); continue; }
    const side = getShortestSide();
    const currentWorst = worstRatio(row, side);
    const nextWorst = worstRatio([...row, item], side);
    if (currentWorst >= nextWorst) { row.push(item); } else { layoutRow(row); row = [item]; }
  }
  if (row.length > 0) { layoutRow(row); }
  return results;
}

export default function PerfectStockMap() {
  const [marketType, setMarketType] = useState('KOSPI200');
  const [stocks, setStocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<{ show: boolean; x: number; y: number; content: React.ReactNode }>({ show: false, x: 0, y: 0, content: null });
  
  const [comments, setComments] = useState<any[]>([]);
  const [inputNick, setInputNick] = useState('');
  const [inputText, setInputText] = useState('');
  const [newsMap, setNewsMap] = useState<{[key: string]: any[]}>({});
  const [marketIndices, setMarketIndices] = useState({
    kospi: { price: 0, change: 0 },
    kosdaq: { price: 0, change: 0 },
    usd: { price: 0, change: 0 },
  });

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const { data } = await supabase.from('stocks').select('*').eq('market', marketType);
      if (data) setStocks(data);
      setLoading(false);
    };
    fetchData();
  }, [marketType]);

  useEffect(() => {
    const fetchMarketIndices = async () => {
      try {
        const res = await fetch('/api/market');
        const data = await res.json();
        if (data.kospi.price !== 0) {
          setMarketIndices(data);
        }
      } catch (e) {
        console.error("Market indices fetch error", e);
      }
    };
    fetchMarketIndices();
    const interval = setInterval(fetchMarketIndices, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchComments = async () => {
    const { data } = await supabase
      .from('comments')
      .select('*')
      .order('created_at', { ascending: true }) 
      .limit(100); 
    if (data) setComments(data);
  };

  useEffect(() => {
    fetchComments();
    const interval = setInterval(fetchComments, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleAddComment = async () => {
    if (!inputNick.trim() || !inputText.trim()) return alert("닉네임과 내용을 입력해주세요.");
    const { error } = await supabase
      .from('comments')
      .insert([{ nick: inputNick, text: inputText }]);
    if (error) {
      console.error(error);
      alert("등록 실패");
    } else {
      setInputText(''); 
      fetchComments(); 
    }
  };

  const handleVote = async (id: number, type: 'up' | 'down') => {
    const storageKey = `voted_${id}`;
    if (localStorage.getItem(storageKey)) {
        alert("이미 평가한 의견입니다.");
        return;
    }
    setComments(prev => prev.map(c => {
        if (c.id === id) {
            return type === 'up' ? { ...c, up: c.up + 1 } : { ...c, down: c.down + 1 };
        }
        return c;
    }));
    localStorage.setItem(storageKey, 'true');
    const rpcName = type === 'up' ? 'increment_up' : 'increment_down';
    await supabase.rpc(rpcName, { row_id: id });
  };

  const filterNewsItems = (items: any[]) => {
    if (!items) return [];
    const BANNED_DOMAINS = ['finomy.com', 'g-enews.com', 'pinpointnews.co.kr', 'thekpm.com', 'famtimes.co.kr', 'nbntv.co.kr'];
    return items.filter(item => {
        const link = item.originallink || item.link || '';
        const titleRaw = item.title || '';
        if (BANNED_DOMAINS.some(domain => link.includes(domain))) return false;
        if ((titleRaw.match(/,/g) || []).length > 30) return false;
        return true;
    });
  };

  useEffect(() => {
    if (stocks.length > 0) {
      const groups: any = {};
      stocks.forEach(s => {
         if (!groups[s.category]) {
             groups[s.category] = { name: s.category, sumRatio: 0, count: 0, totalMarcap: 0, stocks: [] };
         }
         groups[s.category].sumRatio += s.change_ratio;
         groups[s.category].count += 1;
         groups[s.category].totalMarcap += s.marcap;
         groups[s.category].stocks.push(s);
      });
      const candidates = Object.values(groups).filter((g: any) => 
          g.count >= 2 && g.totalMarcap >= 30
      );
      const sortedCandidates = candidates
        .map((g: any) => ({ ...g, avg: g.sumRatio / g.count }))
        .sort((a: any, b: any) => a.avg - b.avg);
      const best2 = sortedCandidates.slice(-2).reverse(); 
      const worst2 = sortedCandidates.slice(0, 2);        

      const fetchNews = async (sectorName: string, stocks: any[], keyword: string) => {
        try {
          let candidates = stocks.filter((s: any) => s.marcap >= 3);
          if (candidates.length === 0) candidates = stocks;
          const sorted = candidates.sort((a: any, b: any) => 
              keyword === '상승' ? b.change_ratio - a.change_ratio : a.change_ratio - b.change_ratio
          );
          const targetStockName = sorted[0]?.name;
          if (!targetStockName) return;
          const searchQuery = `${targetStockName} ${keyword}`; 
          const res = await fetch(`/api/news?query=${encodeURIComponent(searchQuery)}`);
          const json = await res.json();
          const cleanItems = filterNewsItems(json.items || []);
          setNewsMap(prev => ({...prev, [sectorName]: cleanItems}));
        } catch (e) {
          console.error("News fetch error", e);
        }
      };
      best2.forEach(s => fetchNews(s.name, s.stocks, '상승'));
      worst2.forEach(s => fetchNews(s.name, s.stocks, '급락'));
    }
  }, [stocks]);

  const [top2Sectors, bottom2Sectors] = useMemo(() => {
      if (stocks.length === 0) return [[], []];
      const groups: any = {};
      stocks.forEach(s => {
         if (!groups[s.category]) groups[s.category] = { name: s.category, sumRatio: 0, count: 0, totalMarcap: 0 };
         groups[s.category].sumRatio += s.change_ratio;
         groups[s.category].count += 1;
         groups[s.category].totalMarcap += s.marcap;
      });
      const filtered = Object.values(groups).filter((g: any) => g.count >= 2 && g.totalMarcap >= 30);
      const sorted = filtered.map((g: any) => ({ ...g, avg: g.sumRatio / g.count })).sort((a: any, b: any) => a.avg - b.avg);
      return [sorted.slice(-2).reverse(), sorted.slice(0, 2)];
  }, [stocks]);

  const formatMarketCap = (value: number) => {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '조';
  };

  const getBoxColor = (ratio: number) => {
    if (ratio >= 8) return '#8e0000';
    if (ratio >= 6) return '#c62828';
    if (ratio >= 4) return '#d32f2f';
    if (ratio >= 2) return '#f44336';
    if (ratio >= 0) return '#ef9a9a'; 
    if (ratio > -2) return '#90caf9';
    if (ratio > -4) return '#42a5f5';
    if (ratio > -6) return '#1e88e5';
    if (ratio > -8) return '#1565c0';
    return '#0d47a1';
  };

  const getCardStyle = (ratio: number) => {
    if (ratio >= 8) return 'border-red-400 bg-red-400';
    if (ratio >= 6) return 'border-red-300 bg-red-300';
    if (ratio >= 4) return 'border-red-300 bg-red-200';
    if (ratio >= 2) return 'border-red-200 bg-red-100';
    if (ratio >= 0) return 'border-red-200 bg-red-50';
    if (ratio > -2) return 'border-blue-200 bg-blue-50';
    if (ratio > -4) return 'border-blue-200 bg-blue-100';
    if (ratio > -6) return 'border-blue-300 bg-blue-200';
    if (ratio > -8) return 'border-blue-300 bg-blue-300';
    return 'border-blue-400 bg-blue-400';
  };
  
  const getHeaderColor = (ratio: number) => {
     if (ratio >= 6) return 'text-red-900';
     if (ratio >= 0) return 'text-red-700'; 
     if (ratio > -6) return 'text-blue-700';
     return 'text-blue-900';
  }

  const treemapLayout = useMemo(() => {
    if (stocks.length === 0) return [];
    const groups: any = {};
    stocks.forEach(s => {
      if (!groups[s.category]) groups[s.category] = { name: s.category, value: 0, stocks: [], sumRatio: 0, realMarcapSum: 0 };
      groups[s.category].value += s.marcap; 
      groups[s.category].realMarcapSum += s.marcap; // 실제 시총 합계 저장
      groups[s.category].stocks.push(s);
      groups[s.category].sumRatio += s.change_ratio;
    });
    const sectorData = Object.values(groups)
      .map((g: any) => ({ ...g, avgChange: g.sumRatio / g.stocks.length }))
      .sort((a: any, b: any) => b.value - a.value);
    const sectors = recurseSquarify(sectorData, 0, 0, 100, 100);
    return sectors.map(sector => {
      const stockData = sector.stocks
        .map((s: any) => ({ ...s, value: s.marcap }))
        .sort((a: any, b: any) => b.value - a.value);
      const laidOutStocks = recurseSquarify(stockData, sector.x, sector.y, sector.w, sector.h);
      return { ...sector, laidOutStocks };
    });
  }, [stocks]);

  const topRise = [...stocks].filter(s => s.change_ratio > 0).sort((a, b) => b.change_ratio - a.change_ratio).slice(0, 10);
  const topFall = [...stocks].filter(s => s.change_ratio < 0).sort((a, b) => a.change_ratio - b.change_ratio).slice(0, 10);
  
  const sectorRanking = Array.from(new Set(stocks.map(s => s.category)))
    .map(name => {
      const s = stocks.filter(st => st.category === name);
      return { name, avg: s.reduce((a, b) => a + b.change_ratio, 0) / s.length };
    }).sort((a, b) => b.avg - a.avg);

  const cleanTitle = (title: string) => title.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

  return (
    <div className="min-h-screen bg-white text-black font-sans selection:bg-blue-100">
      <header className="w-full max-w-7xl mx-auto py-6 border-b-4 border-black flex justify-between items-center px-4 sticky top-0 bg-white z-50">
        <h1 className="text-4xl font-[1000] italic text-blue-900 tracking-tighter uppercase">KOREA STOCK MAP</h1>
        <div className="flex gap-4 items-center bg-gray-50 px-3 py-1.5 rounded-xl border-2 border-gray-100 shadow-sm">
            <div className="flex flex-col items-end leading-none">
                <span className="text-[10px] font-bold text-gray-500">KOSPI</span>
                <span className={`text-xs font-black ${marketIndices.kospi.change > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                    {marketIndices.kospi.price.toLocaleString(undefined, {maximumFractionDigits: 2})} ({marketIndices.kospi.change > 0 ? '+' : ''}{marketIndices.kospi.change.toFixed(2)}%)
                </span>
            </div>
            <div className="w-[1px] h-6 bg-gray-300"></div>
            <div className="flex flex-col items-end leading-none">
                <span className="text-[10px] font-bold text-gray-500">KOSDAQ</span>
                <span className={`text-xs font-black ${marketIndices.kosdaq.change > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                    {marketIndices.kosdaq.price.toLocaleString(undefined, {maximumFractionDigits: 2})} ({marketIndices.kosdaq.change > 0 ? '+' : ''}{marketIndices.kosdaq.change.toFixed(2)}%)
                </span>
            </div>
            <div className="w-[1px] h-6 bg-gray-300"></div>
            <div className="flex flex-col items-end leading-none">
                <span className="text-[10px] font-bold text-gray-500">USD</span>
                <span className={`text-xs font-black ${marketIndices.usd.change > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                    {marketIndices.usd.price.toLocaleString(undefined, {maximumFractionDigits: 2})} ({marketIndices.usd.change > 0 ? '+' : ''}{marketIndices.usd.change.toFixed(2)}%)
                </span>
            </div>
        </div>
      </header>

      <div className="w-full max-w-7xl mx-auto h-24 bg-gray-50 my-2 border flex items-center justify-center"></div>

      <main className="max-w-7xl mx-auto p-4 space-y-4">
        <div className="flex justify-between items-end pb-2">
            <div className="flex items-center gap-3">
                <div className="flex bg-gray-100 p-0.5 rounded-lg border">
                  {['KOSPI200', 'KOSDAQ150'].map(t => (
                    <button key={t} onClick={() => setMarketType(t)} className={`px-3 py-1 rounded-md font-black text-[10px] transition ${marketType === t ? 'bg-black text-white' : 'text-gray-400'}`}>{t}</button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-[10px] text-gray-400 font-bold flex items-center gap-1">
                    <Clock size={10} /> {new Date().toLocaleString()} (20분 지연 데이터)
                  </div>
                  <div className="flex items-center gap-1 bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md border border-blue-100">
                    <RefreshCcw size={8} />
                    <span className="text-[9px] font-bold uppercase tracking-tighter">데이터는 10분마다 갱신됩니다</span>
                  </div>
                </div>
            </div>
            <div className="text-[11px] text-gray-500 font-bold flex items-center gap-1">
                * 상승률 상위 2개, 하락률 상위 2개 섹터를 표시함
            </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 items-start">
          <div className="lg:w-3/4 flex flex-col gap-6 w-full">
            <div 
              className="relative w-full h-[700px] bg-black border-[4px] border-black overflow-hidden shadow-2xl rounded-sm"
              onMouseLeave={() => setTooltip(prev => ({ ...prev, show: false }))}
            >
              {treemapLayout.map((sector, i) => (
                <div key={i}>
                  <div 
                    style={{ 
                      position: 'absolute', left: `${sector.x}%`, top: `${sector.y}%`, width: `${sector.w}%`, height: `${sector.h}%`,
                      border: `6px solid ${getBoxColor(sector.avgChange)}`,
                      boxShadow: '0 0 0 2px #000', 
                      zIndex: 20, 
                      pointerEvents: 'none'
                    }}
                  >
                    <div 
                      className="absolute top-0 left-0 pointer-events-auto"
                      style={{ display: sector.value >= 30 ? 'block' : 'none' }}
                      onMouseEnter={(e) => setTooltip({show: true, x: e.clientX, y: e.clientY, content: (
                        <div className="p-2 font-bold text-xs whitespace-nowrap">
                          <p className="text-lg">{sector.name}</p>
                          <p className={sector.avgChange > 0 ? 'text-red-500' : 'text-blue-500'}>{sector.avgChange.toFixed(2)}%</p>
                          {/* [수정] value 대신 realMarcapSum을 사용하여 정확한 시총 합계 표시 */}
                          <p className="text-gray-500">{formatMarketCap(sector.realMarcapSum)}</p>
                        </div>
                      )})}
                    >
                      <span className="font-black uppercase leading-none" style={{ fontSize: '12px', color: sector.avgChange > 0 ? '#d32f2f' : '#1565c0', textShadow: '-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff', position: 'relative', top: '-4px', left: '4px', whiteSpace: 'nowrap' }}>
                        {sector.name}
                      </span>
                    </div>
                  </div>
                  {sector.laidOutStocks.map((stock: any, j: number) => (
                    <div 
                      key={j}
                      style={{ 
                        position: 'absolute', left: `${stock.x}%`, top: `${stock.y}%`, width: `${stock.w}%`, height: `${stock.h}%`,
                        backgroundColor: getBoxColor(stock.change_ratio), 
                        border: '0.5px solid rgba(0,0,0,0.15)',
                        zIndex: 10,
                        display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center'
                      }}
                      className="overflow-hidden hover:brightness-110 transition-all cursor-pointer"
                      onMouseEnter={(e) => {
                        e.stopPropagation();
                        setTooltip({show: true, x: e.clientX, y: e.clientY, content: (
                          <div className="p-2 font-bold text-xs whitespace-nowrap">
                            <p className="text-lg">{stock.name}</p>
                            <p className={stock.change_ratio > 0 ? 'text-red-500' : 'text-blue-500'}>{stock.change_ratio.toFixed(2)}%</p>
                            <p className="text-gray-500">{formatMarketCap(stock.marcap)}</p>
                          </div>
                        )});
                      }}
                      onMouseMove={(e) => setTooltip(prev => ({...prev, x: e.clientX, y: e.clientY}))}
                      onMouseLeave={() => setTooltip(prev => ({...prev, show: false}))}
                    >
                      {Math.min(stock.w, stock.h) > 0.5 && (
                        <>
                          <span className="font-[1000] text-white leading-none px-0.5 drop-shadow-sm break-all" style={{ fontSize: `clamp(5px, ${Math.min(stock.w, stock.h) * 0.7}px, 24px)`, lineHeight: '1' }}>{stock.name}</span>
                          <span className="text-white font-bold drop-shadow-md mt-0.5" style={{ fontSize: `clamp(4px, ${Math.min(stock.w, stock.h) * 0.5}px, 12px)`, lineHeight: '1' }}>{stock.change_ratio.toFixed(2)}%</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            
            <div className="bg-white border-4 border-black rounded-3xl p-4 shadow-sm">
              <h3 className="text-lg font-black mb-3 underline decoration-blue-500 uppercase italic flex gap-2"><MessageSquare size={18}/> 토론 게시판</h3>
              <div className="h-[200px] overflow-y-auto mb-3 bg-gray-50 border-2 border-gray-100 rounded-2xl p-2 space-y-2">
                {comments.length === 0 ? <p className="text-xs text-gray-400 text-center py-10">첫 번째 의견을 남겨주세요!</p> : comments.map(c => (
                  <div key={c.id} className="flex justify-between border-b pb-1 text-xs font-bold items-center">
                    <p className="flex-1 truncate pr-2"><span className="text-blue-600">[{c.nick}]</span> {c.text}</p>
                    <div className="flex gap-2 text-[10px] items-center shrink-0">
                        <button 
                            onClick={() => handleVote(c.id, 'up')} 
                            className="flex items-center gap-0.5 hover:text-red-500 hover:scale-110 transition-transform"
                        >
                            <ThumbsUp size={10} /> <span className="text-red-500">{c.up}</span>
                        </button>
                        <button 
                            onClick={() => handleVote(c.id, 'down')} 
                            className="flex items-center gap-0.5 hover:text-blue-500 hover:scale-110 transition-transform"
                        >
                            <ThumbsDown size={10} /> <span className="text-blue-500">{c.down}</span>
                        </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-1">
                <input 
                  className="flex-[1] border-2 border-black p-1.5 rounded-lg font-bold text-xs" 
                  placeholder="닉네임" 
                  value={inputNick}
                  onChange={(e) => setInputNick(e.target.value)}
                />
                <input 
                  className="flex-[4] border-2 border-black p-1.5 rounded-lg font-bold text-xs" 
                  placeholder="의견 입력" 
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                />
                <button 
                  className="flex-1 bg-blue-700 text-white font-black rounded-lg text-xs shadow-[2px_2px_0px_#000] active:translate-y-1 active:shadow-none transition-all"
                  onClick={handleAddComment}
                >
                  등록
                </button>
              </div>
            </div>
          </div>

          <div className="lg:w-1/4 space-y-4 flex flex-col">
              {top2Sectors.map((sector, idx) => (
                <div key={`rise-${idx}`} className={`bg-white border-4 rounded-3xl p-4 shadow-sm ${sector.avg > 0 ? 'border-red-500' : 'border-blue-500'}`}>
                   <div className={`flex justify-between items-center border-b-2 pb-2 mb-2 ${sector.avg > 0 ? 'border-red-100' : 'border-blue-100'}`}>
                      <h3 className={`font-black italic uppercase flex items-center gap-1 text-sm ${sector.avg > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                         {sector.avg > 0 ? '🔥' : '💧'} {sector.name} <span className="text-[10px] text-gray-400">#{idx+1}</span>
                      </h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${sector.avg > 0 ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                        {sector.avg > 0 ? '+' : ''}{sector.avg.toFixed(2)}%
                      </span>
                   </div>
                   <ul className="space-y-2">
                      {newsMap[sector.name] ? (
                          newsMap[sector.name].length === 0 ? <li className="text-xs text-center text-gray-400">관련 기사가 없습니다.</li> :
                          newsMap[sector.name].slice(0, 4).map((item:any, i:number) => (
                            <li key={i} className="text-[11px] font-bold leading-tight">
                               <a href={item.link} target="_blank" rel="noopener noreferrer" className={`hover:underline flex gap-1 items-start text-gray-800 ${sector.avg > 0 ? 'hover:text-red-600' : 'hover:text-blue-600'}`}>
                                  <span className={`mt-[1px] ${sector.avg > 0 ? 'text-red-400' : 'text-blue-400'}`}>•</span> {cleanTitle(item.title)}
                               </a>
                            </li>
                          ))
                      ) : (
                          <li className="text-xs text-center">뉴스 로딩중...</li>
                      )}
                   </ul>
                </div>
              ))}

              {bottom2Sectors.map((sector, idx) => (
                <div key={`fall-${idx}`} className={`bg-white border-4 rounded-3xl p-4 shadow-sm ${sector.avg > 0 ? 'border-red-500' : 'border-blue-500'}`}>
                   <div className={`flex justify-between items-center border-b-2 pb-2 mb-2 ${sector.avg > 0 ? 'border-red-100' : 'border-blue-100'}`}>
                      <h3 className={`font-black italic uppercase flex items-center gap-1 text-sm ${sector.avg > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                         {sector.avg > 0 ? '🔥' : '💧'} {sector.name} <span className="text-[10px] text-gray-400">#{idx+1}</span>
                      </h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${sector.avg > 0 ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                        {sector.avg > 0 ? '+' : ''}{sector.avg.toFixed(2)}%
                      </span>
                   </div>
                   <ul className="space-y-2">
                      {newsMap[sector.name] ? (
                          newsMap[sector.name].length === 0 ? <li className="text-xs text-center text-gray-400">관련 기사가 없습니다.</li> :
                          newsMap[sector.name].slice(0, 4).map((item:any, i:number) => (
                            <li key={i} className="text-[11px] font-bold leading-tight">
                               <a href={item.link} target="_blank" rel="noopener noreferrer" className={`hover:underline flex gap-1 items-start text-gray-800 ${sector.avg > 0 ? 'hover:text-red-600' : 'hover:text-blue-600'}`}>
                                  <span className={`mt-[1px] ${sector.avg > 0 ? 'text-red-400' : 'text-blue-400'}`}>•</span> {cleanTitle(item.title)}
                               </a>
                            </li>
                          ))
                      ) : (
                          <li className="text-xs text-center">뉴스 로딩중...</li>
                      )}
                   </ul>
                </div>
              ))}

              <div className="bg-white border-4 border-black rounded-3xl p-4 shadow-sm">
                 <div className="flex gap-2">
                   <div className="flex-1 border-r-2 border-gray-100 pr-2">
                     <h3 className="font-black text-xs italic uppercase border-b-2 border-black pb-2 mb-2 flex items-center gap-1 text-red-600">
                        <TrendingUp size={12} /> 상승 TOP 10
                     </h3>
                     <div className="space-y-1">
                        {topRise.length > 0 ? topRise.map((s, i) => (
                           <div key={i} className="flex justify-between items-center text-[10px] font-bold border-b border-gray-50 last:border-0 py-1">
                              <div className="flex gap-1 items-center w-full overflow-hidden">
                                 <span className="text-gray-400 w-3 text-[9px]">{i+1}</span>
                                 <a 
                                    href={`https://finance.naver.com/item/main.naver?code=${s.code?.toString().padStart(6, '0')}`}
                                    target="_blank"
                                    rel="noopener noreferrer" 
                                    className="truncate hover:underline hover:text-blue-800 cursor-pointer"
                                 >
                                    {s.name}
                                 </a>
                              </div>
                              <span className="text-red-500 whitespace-nowrap text-[9px]">+{s.change_ratio.toFixed(2)}%</span>
                           </div>
                        )) : <div className="text-[10px] text-gray-400 text-center py-2">상승 종목 없음</div>}
                     </div>
                   </div>

                   <div className="flex-1 pl-2">
                     <h3 className="font-black text-xs italic uppercase border-b-2 border-black pb-2 mb-2 flex items-center gap-1 text-blue-600">
                        <TrendingDown size={12} /> 하락 TOP 10
                     </h3>
                     <div className="space-y-1">
                        {topFall.length > 0 ? topFall.map((s, i) => (
                           <div key={i} className="flex justify-between items-center text-[10px] font-bold border-b border-gray-50 last:border-0 py-1">
                              <div className="flex gap-1 items-center w-full overflow-hidden">
                                 <span className="text-gray-400 w-3 text-[9px]">{i+1}</span>
                                 <a 
                                    href={`https://finance.naver.com/item/main.naver?code=${s.code?.toString().padStart(6, '0')}`}
                                    target="_blank"
                                    rel="noopener noreferrer" 
                                    className="truncate hover:underline hover:text-blue-800 cursor-pointer"
                                 >
                                    {s.name}
                                 </a>
                              </div>
                              <span className="text-blue-500 whitespace-nowrap text-[9px]">{s.change_ratio.toFixed(2)}%</span>
                           </div>
                        )) : <div className="text-[10px] text-gray-400 text-center py-2">하락 종목 없음</div>}
                     </div>
                   </div>
                 </div>
              </div>

          </div>
        </div>

        <div className="w-full h-24 bg-gray-50 flex items-center justify-center border-2 border-dashed"></div>
        
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="lg:w-48 space-y-1 border-t-4 border-black pt-3"> 
            <h2 className="font-bold text-base underline decoration-blue-500 underline-offset-4 mb-2">섹터 상승률 순위</h2>
            {sectorRanking.map((s, i) => (
              <div key={i} className="flex justify-between text-[11px] font-bold border-b border-gray-100 py-1"> 
                <span className="text-black">#{i+1} {s.name}</span>
                <span className={s.avg >= 0 ? 'text-red-500' : 'text-blue-500'}>{s.avg.toFixed(2)}%</span> 
              </div>
            ))}
          </div>
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4"> 
            {sectorRanking.map((s, i) => (
              <div 
                key={i} 
                className={`border-4 rounded-3xl p-5 h-[350px] flex flex-col shadow-lg ${getCardStyle(s.avg)}`}
              >
                <p className={`font-black border-b-4 pb-2 mb-3 text-sm flex justify-between uppercase italic ${
                    s.avg >= 0 ? 'border-red-400/30' : 'border-blue-400/30'
                }`}>
                    <span className={getHeaderColor(s.avg)}>{s.name}</span>
                    <span className={getHeaderColor(s.avg)}>{s.avg.toFixed(2)}%</span>
                </p>
                <div className="overflow-y-auto flex-1 space-y-2 scrollbar-hide">
                  {stocks.filter(st => st.category === s.name).sort((a,b)=>b.change_ratio-a.change_ratio).map((st, j) => (
                    <div key={j} className="flex justify-between text-[11px] font-bold border-b border-black/5 pb-1 italic">
                        <a 
                           href={`https://finance.naver.com/item/main.naver?code=${st.code?.toString().padStart(6, '0')}`}
                           target="_blank"
                           rel="noopener noreferrer" 
                           className="hover:underline hover:text-black cursor-pointer text-black"
                        >
                            {st.name}
                        </a>
                        <span className={st.change_ratio >= 0 ? 'text-red-700' : 'text-blue-700'}>{st.change_ratio.toFixed(2)}%</span> 
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer className="w-full pt-16 border-t px-4 pb-10 text-center space-y-4">
          <div className="max-w-4xl mx-auto">
            <p className="text-[12px] text-gray-800 font-bold leading-relaxed">
              본 사이트에서 제공하는 정보는 투자 참고용이며, 데이터 오류나 지연이 발생할 수 있습니다.<br />
              이를 이용한 투자 결과에 대해 어떠한 법적 책임도 지지 않습니다.
            </p>
          </div>
          <div className="w-full h-24 bg-gray-50 mt-6 border-2 border-dashed flex items-center justify-center"></div>
        </footer>
      </main>

      {tooltip.show && (
        <div className="fixed bg-white border-2 border-black p-3 shadow-xl z-[9999] rounded-xl font-bold text-xs pointer-events-none" style={{ left: tooltip.x + 15, top: tooltip.y + 15 }}>
          {tooltip.content}
        </div>
      )}
    </div>
  );
}