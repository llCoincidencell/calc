import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Trash2, Calculator, TrendingUp, TrendingDown, Info, LayoutList, Eye, EyeOff, X, ArrowRight, Target, AlertCircle, Wallet, RotateCcw, Pencil, Check, Minus, ArrowUpCircle, ArrowDownCircle, Menu } from 'lucide-react';
import { Transaction, PortfolioSummary, SimulationResult } from './types';
import { Button } from './components/Button';
import { Card } from './components/Card';

const App: React.FC = () => {
  // --- State with Persistence ---
  
  const [stockList, setStockList] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('borsa_stocks');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) { console.error("Stok listesi yüklenemedi", e); }
      }
    }
    return ['GENEL'];
  });

  const [activeSymbol, setActiveSymbol] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('borsa_stocks');
      const list = saved ? JSON.parse(saved) : ['GENEL'];
      return list[0] || 'GENEL';
    }
    return 'GENEL';
  });

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('borsa_transactions');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Migrate old data: default to BUY type if missing, isActive true
          return parsed.map((t: any) => ({ 
            ...t, 
            isActive: t.isActive !== false,
            type: t.type || 'BUY' 
          }));
        } catch (e) { console.error("İşlemler yüklenemedi", e); }
      }
    }
    return [];
  });

  const [isAddingStock, setIsAddingStock] = useState(false);
  const [newStockName, setNewStockName] = useState('');
  
  // Renaming State
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  
  // Inputs
  const [transactionType, setTransactionType] = useState<'BUY' | 'SELL'>('BUY');
  const [inputPrice, setInputPrice] = useState<string>('');
  const [inputQuantity, setInputQuantity] = useState<string>('');
  const [simulationPrice, setSimulationPrice] = useState<string>('');
  
  // Cost Averaging State
  const [targetAverageInput, setTargetAverageInput] = useState<string>('');

  // Undo State
  const [backupTransactions, setBackupTransactions] = useState<Transaction[] | null>(null);
  const [showUndoToast, setShowUndoToast] = useState(false);

  // --- Persistence Effects ---
  useEffect(() => {
    localStorage.setItem('borsa_stocks', JSON.stringify(stockList));
  }, [stockList]);

  useEffect(() => {
    localStorage.setItem('borsa_transactions', JSON.stringify(transactions));
  }, [transactions]);

  // Focus on rename input when active
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
    }
  }, [isRenaming]);

  // Toast Timer
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (showUndoToast) {
      timer = setTimeout(() => {
        setShowUndoToast(false);
        setBackupTransactions(null); // Clear backup after timeout
      }, 5000);
    }
    return () => clearTimeout(timer);
  }, [showUndoToast]);

  // --- Derived State (Calculations) ---
  
  // Filter transactions for the currently selected stock
  const currentTransactions = useMemo(() => {
    // Sort by timestamp to ensure correct calculation order
    return transactions
      .filter(t => t.symbol === activeSymbol)
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [transactions, activeSymbol]);

  // Enhanced Transactions with Historical Context for Realized P/L
  // We need to calculate the running average cost AT THE TIME of each transaction
  // to determine the realized profit for sales.
  const transactionsWithStats = useMemo(() => {
    let runningQty = 0;
    let runningTotalCost = 0;
    
    return currentTransactions.map(t => {
      const isActive = t.isActive !== false;
      let realizedPL = null;
      let realizedPLPercent = 0;

      // Calculate stats BEFORE this transaction affects the pool (for Sales)
      // or AFTER (for Buys - though for buys we usually care about future price)
      // Standard FIFO/Weighted Avg logic:
      // When selling, the cost basis is the Current Weighted Average.
      
      const currentAvgCost = runningQty > 0 ? runningTotalCost / runningQty : 0;

      if (isActive) {
        if (t.type === 'BUY') {
          runningTotalCost += (t.price * t.quantity);
          runningQty += t.quantity;
        } else {
          // It's a SELL
          // Realized Profit = (Sell Price - Average Cost) * Quantity
          if (runningQty > 0) {
             const costBasis = t.quantity * currentAvgCost;
             const saleProceeds = t.quantity * t.price;
             realizedPL = saleProceeds - costBasis;
             realizedPLPercent = currentAvgCost > 0 ? ((t.price - currentAvgCost) / currentAvgCost) * 100 : 0;
             
             // Update running totals
             runningQty -= t.quantity;
             // Total Cost reduces proportionally
             runningTotalCost -= costBasis;
          } else {
             // Selling short or from 0
             runningQty -= t.quantity;
             // Simple logic for < 0
             runningTotalCost -= (t.price * t.quantity);
          }
        }
      }
      
      // Fix floating point issues
      runningQty = Math.max(0, runningQty);
      runningTotalCost = Math.max(0, runningTotalCost);

      return {
        ...t,
        realizedPL,
        realizedPLPercent
      };
    });
  }, [currentTransactions]);

  // Calculate Summary based ONLY on ACTIVE transactions
  const summary: PortfolioSummary = useMemo(() => {
    const activeTx = currentTransactions.filter(t => t.isActive !== false);

    if (activeTx.length === 0) {
      return { totalQuantity: 0, totalCost: 0, averageCost: 0 };
    }

    let currentQty = 0;
    let currentTotalCost = 0; 

    for (const t of activeTx) {
      if (t.type === 'BUY') {
        currentTotalCost += (t.price * t.quantity);
        currentQty += t.quantity;
      } else { 
        if (currentQty > 0) {
          const avgCost = currentTotalCost / currentQty;
          currentQty -= t.quantity;
          currentTotalCost = currentQty * avgCost; 
        } else {
          currentQty -= t.quantity;
          currentTotalCost -= (t.price * t.quantity);
        }
      }
    }

    currentQty = Math.max(0, currentQty); 
    currentTotalCost = Math.max(0, currentTotalCost);
    
    const avg = currentQty > 0 ? currentTotalCost / currentQty : 0;

    return {
      totalQuantity: currentQty,
      totalCost: currentTotalCost,
      averageCost: avg
    };
  }, [currentTransactions]);

  // Calculate Preview (What IF we add this transaction?)
  const previewData = useMemo(() => {
    const p = parseFloat(inputPrice);
    const q = parseFloat(inputQuantity);

    if (isNaN(p) || isNaN(q) || p <= 0 || q <= 0) return null;

    const currentQ = summary.totalQuantity;
    const currentC = summary.totalCost; // Basis
    const currentAvg = summary.averageCost;

    let futureQ = 0;
    let futureC = 0;
    let estimatedRealizedPL = 0;

    if (transactionType === 'BUY') {
       futureQ = currentQ + q;
       futureC = currentC + (p * q);
    } else {
       // Sell Preview
       futureQ = Math.max(0, currentQ - q);
       futureC = futureQ * currentAvg;
       estimatedRealizedPL = (p - currentAvg) * q;
    }
    
    const futureAvg = futureQ > 0 ? futureC / futureQ : 0;
    const diff = futureAvg - currentAvg;

    return {
      newAvg: futureAvg,
      diff: diff,
      isFirst: currentQ === 0,
      estimatedRealizedPL: transactionType === 'SELL' ? estimatedRealizedPL : null
    };
  }, [inputPrice, inputQuantity, transactionType, summary]);

  const simulation: SimulationResult | null = useMemo(() => {
    if (!simulationPrice || summary.totalQuantity === 0) return null;

    const currentP = parseFloat(simulationPrice);
    if (isNaN(currentP)) return null;

    const currentVal = currentP * summary.totalQuantity;
    const plTotal = currentVal - summary.totalCost;
    const plPerShare = currentP - summary.averageCost;
    const pctChange = summary.averageCost > 0 ? (plPerShare / summary.averageCost) * 100 : 0;

    return {
      currentValue: currentVal,
      profitOrLossTotal: plTotal,
      profitOrLossPerShare: plPerShare,
      percentageChange: pctChange,
      status: plTotal > 0 ? 'PROFIT' : plTotal < 0 ? 'LOSS' : 'NEUTRAL'
    };
  }, [simulationPrice, summary]);

  // Cost Averaging Calculation
  const costAveragingData = useMemo(() => {
    if (!simulation || simulation.status !== 'LOSS' || !targetAverageInput) return null;
    
    const targetAvg = parseFloat(targetAverageInput);
    const simPrice = parseFloat(simulationPrice);
    
    if (isNaN(targetAvg) || targetAvg <= 0) return null;
    
    if (targetAvg <= simPrice) {
      return { error: "Hedef > Anlık Fiyat" };
    }
    
    if (targetAvg >= summary.averageCost) {
      return { error: "Hedef < Ort. Maliyet" };
    }
    
    const requiredQty = summary.totalQuantity * (summary.averageCost - targetAvg) / (targetAvg - simPrice);
    const requiredCapital = requiredQty * simPrice;

    return {
      requiredQty,
      requiredCapital,
      error: null
    };
  }, [simulation, targetAverageInput, simulationPrice, summary]);


  // --- Handlers ---

  const handleAddStock = (e: React.FormEvent) => {
    e.preventDefault();
    if (newStockName.trim()) {
      const name = newStockName.toUpperCase().trim();
      if (!stockList.includes(name)) {
        setStockList([...stockList, name]);
      }
      setActiveSymbol(name);
      setNewStockName('');
      setIsAddingStock(false);
      // Reset inputs
      setSimulationPrice('');
      setInputPrice('');
      setInputQuantity('');
      setTargetAverageInput('');
    }
  };

  const startRenaming = () => {
    setRenameValue(activeSymbol);
    setIsRenaming(true);
  };

  const handleRenameStock = (e: React.FormEvent) => {
    e.preventDefault();
    const newName = renameValue.toUpperCase().trim();
    if (!newName) return;
    if (newName === activeSymbol) {
      setIsRenaming(false);
      return;
    }
    if (stockList.includes(newName)) {
      alert("Bu isimde bir portföy zaten var.");
      return;
    }
    const newStockList = stockList.map(s => s === activeSymbol ? newName : s);
    setStockList(newStockList);
    const newTransactions = transactions.map(t => 
      t.symbol === activeSymbol ? { ...t, symbol: newName } : t
    );
    setTransactions(newTransactions);
    setActiveSymbol(newName);
    setIsRenaming(false);
  };

  const handleAddTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseFloat(inputPrice);
    const q = parseFloat(inputQuantity);

    if (isNaN(p) || isNaN(q) || p <= 0 || q <= 0) return;

    const newTransaction: Transaction = {
      id: crypto.randomUUID(),
      symbol: activeSymbol,
      price: p,
      quantity: q,
      timestamp: Date.now(),
      isActive: true,
      type: transactionType
    };

    setTransactions(prev => [...prev, newTransaction]);
    
    // Auto set simulation price if empty (only for buys usually, but let's allow generic)
    if (!simulationPrice && transactionType === 'BUY') {
      setSimulationPrice(p.toString());
    }

    setInputPrice('');
    setInputQuantity('');
  };

  const removeTransaction = (id: string) => {
    setTransactions(transactions.filter(t => t.id !== id));
  };

  const toggleTransactionStatus = (id: string) => {
    setTransactions(transactions.map(t => 
      t.id === id ? { ...t, isActive: !t.isActive } : t
    ));
  };

  const deleteCurrentStock = () => {
    if (stockList.length <= 1) {
      alert("En az bir hisse grubu kalmalıdır.");
      return;
    }
    if (window.confirm(`${activeSymbol} hissesini ve tüm işlemlerini silmek istediğinize emin misiniz?`)) {
      setTransactions(transactions.filter(t => t.symbol !== activeSymbol));
      const newList = stockList.filter(s => s !== activeSymbol);
      setStockList(newList);
      setActiveSymbol(newList[0]);
      setSimulationPrice('');
      setTargetAverageInput('');
    }
  };

  const handleResetTransactions = () => {
    const txsToRemove = transactions.filter(t => t.symbol === activeSymbol);
    if (txsToRemove.length === 0) return;
    setBackupTransactions(txsToRemove);
    setTransactions(transactions.filter(t => t.symbol !== activeSymbol));
    setSimulationPrice('');
    setTargetAverageInput('');
    setShowUndoToast(true);
  };

  const handleUndoDelete = () => {
    if (backupTransactions) {
      setTransactions(prev => [...prev, ...backupTransactions]);
      setBackupTransactions(null);
      setShowUndoToast(false);
    }
  };

  // --- Formatting Helpers ---
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(val);
  };
  
  const formatNumber = (val: number) => {
     return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(val);
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-8 relative">
      {/* Header - Compact */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-20 shadow-lg">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2 h-12 sm:h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <div className="bg-indigo-500 p-1.5 rounded-lg">
              <Calculator className="h-4 w-4 text-white" />
            </div>
            <h1 className="text-base sm:text-lg font-bold text-white tracking-tight hidden sm:block">Borsa Ortalama Maliyet Hesaplayici</h1>
          </div>
          
          <div className="flex-1 flex items-center justify-end space-x-1 overflow-x-auto no-scrollbar mask-gradient-r">
             {stockList.map(stock => (
               <button
                  key={stock}
                  onClick={() => {
                     setActiveSymbol(stock);
                     setSimulationPrice(''); 
                     setTargetAverageInput('');
                     setIsRenaming(false);
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
                     activeSymbol === stock 
                     ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20 ring-1 ring-indigo-500' 
                     : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                  }`}
               >
                  {stock}
               </button>
             ))}
             
             {isAddingStock ? (
                <form onSubmit={handleAddStock} className="flex items-center ml-1 shrink-0">
                   <input 
                      autoFocus
                      type="text" 
                      placeholder="Sembol" 
                      className="w-20 px-2 py-1 text-xs bg-slate-800 border border-slate-700 text-white rounded-l-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 uppercase placeholder-slate-500"
                      value={newStockName}
                      onChange={e => setNewStockName(e.target.value)}
                      onBlur={() => !newStockName && setIsAddingStock(false)}
                   />
                   <button type="submit" className="bg-emerald-600 text-white px-2 py-1 rounded-r-lg hover:bg-emerald-700 text-xs font-medium transition-colors">Ekle</button>
                </form>
             ) : (
                <button 
                  onClick={() => setIsAddingStock(true)}
                  className="p-1 rounded-full bg-slate-800 text-slate-400 hover:bg-indigo-600 hover:text-white transition-all ml-1 shrink-0"
                  title="Yeni Hisse Ekle"
                >
                   <Plus className="w-3.5 h-3.5" />
                </button>
             )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 space-y-4">
        
        {/* Top Header for Selected Stock - Compact */}
        <div className="flex flex-row items-center justify-between border-b border-gray-200 pb-3 gap-4">
           <div className="flex items-center gap-3">
              {isRenaming ? (
                <form onSubmit={handleRenameStock} className="flex items-center gap-1 w-full">
                   <input 
                     ref={renameInputRef}
                     type="text" 
                     className="text-xl font-extrabold text-slate-900 bg-white border-b-2 border-indigo-500 focus:outline-none uppercase w-40 tracking-tight"
                     value={renameValue}
                     onChange={(e) => setRenameValue(e.target.value)}
                   />
                   <button type="submit" className="p-1.5 bg-emerald-100 text-emerald-700 rounded-full hover:bg-emerald-200 transition-colors shrink-0"><Check className="w-4 h-4" /></button>
                   <button type="button" onClick={() => setIsRenaming(false)} className="p-1.5 bg-slate-100 text-slate-600 rounded-full hover:bg-slate-200 transition-colors shrink-0"><X className="w-4 h-4" /></button>
                </form>
              ) : (
                <>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight truncate">{activeSymbol}</h2>
                  <button onClick={startRenaming} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all shrink-0"><Pencil className="w-3.5 h-3.5" /></button>
                </>
              )}
           </div>
           
           <div className="flex gap-2">
              {currentTransactions.length > 0 && (
                <button onClick={handleResetTransactions} className="text-xs font-medium text-slate-500 hover:text-rose-600 transition-colors flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-rose-50 rounded-lg group">
                    <Trash2 className="w-3.5 h-3.5 group-hover:animate-bounce" /> <span className="hidden sm:inline">Temizle</span>
                </button>
              )}
              {stockList.length > 1 && (
                 <button onClick={deleteCurrentStock} className="text-xs font-medium text-rose-500 hover:text-rose-700 transition-colors flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-rose-50 rounded-lg">
                    <X className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Sil</span>
                 </button>
              )}
           </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          
          {/* Column 1: Summary - Compact */}
          <Card title="Cüzdan" className="lg:col-span-1 shadow-lg shadow-indigo-100/40">
             <div className="space-y-3">
                <div className="text-center p-4 bg-gradient-to-br from-slate-900 to-indigo-900 rounded-xl shadow-md text-white relative overflow-hidden">
                   <div className="absolute top-0 right-0 -mt-2 -mr-2 w-16 h-16 bg-white opacity-5 rounded-full blur-xl"></div>
                   
                   <p className="text-[10px] text-indigo-200 font-bold uppercase tracking-widest mb-1 relative z-10">Ortalama Maliyet</p>
                   <p className="text-2xl sm:text-3xl font-black text-white tracking-tight relative z-10 break-all">
                      {formatCurrency(summary.averageCost)}
                   </p>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                   <div className="p-2 bg-white rounded-lg text-center border border-gray-100 shadow-sm">
                      <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide mb-0.5">Mevcut Lot</p>
                      <p className="text-sm sm:text-base font-bold text-slate-800">{formatNumber(summary.totalQuantity)}</p>
                   </div>
                   <div className="p-2 bg-white rounded-lg text-center border border-gray-100 shadow-sm">
                      <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide mb-0.5">Mevcut Değer</p>
                      <p className="text-sm sm:text-base font-bold text-slate-800 break-all">{formatCurrency(summary.totalCost)}</p>
                   </div>
                </div>
             </div>
          </Card>

          {/* Column 2: Simulation - Compact */}
          <Card title="Simülasyon" className="lg:col-span-2 shadow-lg shadow-gray-100/40">
             <div className="flex flex-col h-full">
                
                <div className="mb-4">
                   <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 shadow-sm relative overflow-hidden flex items-center gap-4">
                      <div className="flex-1">
                        <label htmlFor="simPrice" className="block text-[10px] font-extrabold text-amber-800 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                           <Target className="w-3.5 h-3.5 text-amber-600" />
                           Hedef / Anlık Fiyat
                        </label>
                        <div className="relative">
                           <input
                             type="number"
                             id="simPrice"
                             className="block w-full rounded-lg border-amber-300 bg-white px-3 py-2 text-xl font-black text-slate-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 transition-all shadow-inner h-10"
                             placeholder="0.00"
                             value={simulationPrice}
                             onChange={(e) => {
                                setSimulationPrice(e.target.value);
                                setTargetAverageInput(''); 
                             }}
                           />
                           {simulationPrice && (
                              <button 
                                 onClick={() => {
                                    setSimulationPrice('');
                                    setTargetAverageInput('');
                                 }} 
                                 className="absolute inset-y-0 right-2 flex items-center text-amber-300 hover:text-amber-600"
                              >
                                 <X className="w-5 h-5 bg-amber-100 rounded-full p-0.5" />
                              </button>
                           )}
                        </div>
                      </div>
                      
                      {/* Mini Info - Hidden on very small screens */}
                      <div className="hidden sm:block text-right pr-2">
                          <p className="text-[10px] text-amber-700/60 font-medium">Kar/Zarar analizi</p>
                      </div>
                   </div>
                </div>

                {simulation ? (
                   <div className="space-y-4 mt-auto animate-in fade-in slide-in-from-bottom-2 duration-300">
                      {/* Status Box Compact */}
                      <div className={`p-4 rounded-xl border ${simulation.status === 'PROFIT' ? 'bg-white border-emerald-500 shadow-emerald-50' : simulation.status === 'LOSS' ? 'bg-white border-rose-500 shadow-rose-50' : 'bg-gray-50 border-gray-200'} shadow-md transition-all`}>
                         
                         <div className="grid grid-cols-2 md:flex md:items-center gap-y-3 gap-x-2 md:gap-8">
                            
                            <div className="col-span-2 md:w-auto md:flex-1 text-left">
                               <p className={`text-[10px] font-bold uppercase tracking-widest mb-0.5 ${simulation.status === 'PROFIT' ? 'text-emerald-700' : 'text-rose-700'}`}>
                                  {simulation.status === 'PROFIT' ? 'Net Kar' : 'Net Zarar'}
                               </p>
                               <p className={`text-2xl sm:text-3xl font-black tracking-tight leading-none ${simulation.status === 'PROFIT' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                  {simulation.profitOrLossTotal > 0 ? '+' : ''}{formatCurrency(simulation.profitOrLossTotal)}
                               </p>
                            </div>
                            
                            <div className="col-span-1 md:w-auto text-left md:text-center md:px-6 md:border-l md:border-r border-gray-100/50">
                               <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wide mb-0.5">Lot Başına</p>
                               <div className="flex items-center gap-1">
                                  {simulation.status === 'PROFIT' ? <TrendingUp className="w-3.5 h-3.5 text-emerald-500"/> : <TrendingDown className="w-3.5 h-3.5 text-rose-500"/>}
                                  <span className={`text-base font-bold font-mono ${simulation.status === 'PROFIT' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                     {simulation.profitOrLossPerShare > 0 ? '+' : ''}{formatNumber(simulation.profitOrLossPerShare)}
                                  </span>
                               </div>
                            </div>

                            <div className="col-span-1 md:w-auto text-left md:text-right">
                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wide mb-0.5">Değişim</p>
                                <div className={`text-lg font-bold tracking-tight ${simulation.status === 'PROFIT' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                   % {formatNumber(simulation.percentageChange)}
                                </div>
                            </div>
                         </div>
                      </div>

                      {/* Cost Averaging Calculator Compact */}
                      {simulation.status === 'LOSS' && (
                         <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                            <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex items-center gap-2">
                               <Target className="w-3.5 h-3.5 text-indigo-600" />
                               <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Maliyet Düşürme</h4>
                            </div>
                            
                            <div className="p-3 bg-white">
                               <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                                  <div>
                                     <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Hedef Ort.</label>
                                     <input
                                        type="number"
                                        className="block w-full rounded-lg border-slate-200 bg-slate-50 text-slate-900 font-bold text-sm py-2 px-3 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 h-9"
                                        placeholder={formatNumber(summary.averageCost - (summary.averageCost * 0.1))}
                                        value={targetAverageInput}
                                        onChange={(e) => setTargetAverageInput(e.target.value)}
                                     />
                                  </div>

                                  <div className="w-full">
                                      {costAveragingData ? (
                                         costAveragingData.error ? (
                                            <div className="p-2 rounded-lg bg-rose-50 text-rose-700 text-xs font-medium flex items-center gap-1.5 h-9">
                                               <AlertCircle className="w-4 h-4 shrink-0" />
                                               <span>{costAveragingData.error}</span>
                                            </div>
                                         ) : (
                                            <div className="bg-slate-900 rounded-lg px-3 py-1.5 text-white shadow-md flex justify-between items-center h-9">
                                               <div className="flex items-center gap-2">
                                                  <span className="text-[10px] text-slate-400 font-bold uppercase">Al:</span>
                                                  <span className="text-sm font-bold text-emerald-400">{formatNumber(costAveragingData.requiredQty)} Lot</span>
                                               </div>
                                               <div className="h-4 w-px bg-slate-700 mx-2"></div>
                                               <div className="flex items-center gap-2">
                                                  <span className="text-[10px] text-slate-400 font-bold uppercase">Tutar:</span>
                                                  <span className="text-sm font-mono text-white">{formatCurrency(costAveragingData.requiredCapital)}</span>
                                               </div>
                                            </div>
                                         )
                                      ) : (
                                         <div className="h-9 rounded-lg border border-dashed border-slate-200 text-slate-400 text-[10px] flex items-center justify-center">
                                            Hesaplama için hedef giriniz
                                         </div>
                                      )}
                                  </div>
                               </div>
                            </div>
                         </div>
                      )}
                   </div>
                ) : (
                   <div className="mt-auto p-4 text-center opacity-40">
                      <p className="text-gray-400 font-medium text-xs">Simülasyon için fiyat giriniz.</p>
                   </div>
                )}
             </div>
          </Card>
        </div>

        {/* Input & List Section */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
           
           {/* Add Transaction Form Compact */}
           <div className="lg:col-span-4">
              <Card title="İşlem Ekle" className="h-full shadow-lg">
                 <div className="grid grid-cols-2 gap-2 mb-3 p-1 bg-slate-100 rounded-lg">
                    <button
                       type="button"
                       onClick={() => setTransactionType('BUY')}
                       className={`py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${transactionType === 'BUY' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white'}`}
                    >
                       <ArrowUpCircle className="w-3.5 h-3.5" /> Alış
                    </button>
                    <button
                       type="button"
                       onClick={() => setTransactionType('SELL')}
                       className={`py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${transactionType === 'SELL' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white'}`}
                    >
                       <ArrowDownCircle className="w-3.5 h-3.5" /> Satış
                    </button>
                 </div>

                 <form onSubmit={handleAddTransaction} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                           <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                              {transactionType === 'BUY' ? 'Alış Fiyatı' : 'Satış Fiyatı'}
                           </label>
                           <input 
                              type="number" 
                              step="0.01" 
                              required
                              className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-2 px-3 text-sm bg-gray-50 focus:bg-white transition-colors h-10"
                              placeholder="0.00"
                              value={inputPrice}
                              onChange={e => setInputPrice(e.target.value)}
                           />
                        </div>
                        <div>
                           <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Adet</label>
                           <input 
                              type="number" 
                              step="1" 
                              required
                              className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-2 px-3 text-sm bg-gray-50 focus:bg-white transition-colors h-10"
                              placeholder="0"
                              value={inputQuantity}
                              onChange={e => setInputQuantity(e.target.value)}
                           />
                        </div>
                    </div>

                    {/* PREVIEW BOX */}
                    {previewData && (
                       <div className={`p-3 rounded-lg border animate-in fade-in slide-in-from-top-1 duration-200 ${transactionType === 'BUY' ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
                          <div className="flex items-center justify-between">
                             <span className={`text-[10px] font-bold uppercase tracking-wide ${transactionType === 'BUY' ? 'text-emerald-800' : 'text-rose-800'}`}>
                                Yeni Ortalama
                             </span>
                             <span className={`text-sm font-bold bg-white px-1.5 py-0.5 rounded shadow-sm ${transactionType === 'BUY' ? 'text-emerald-700' : 'text-rose-700'}`}>
                                {formatCurrency(previewData.newAvg)}
                             </span>
                          </div>
                          {!previewData.isFirst && Math.abs(previewData.diff) > 0.001 && (
                             <div className="flex items-center justify-end text-[10px] pt-1 mt-1 border-t border-gray-200/30">
                                <span className={`flex items-center font-bold px-1.5 rounded-full ${previewData.diff > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                   {previewData.diff > 0 ? <TrendingUp className="w-3 h-3 mr-1"/> : <TrendingDown className="w-3 h-3 mr-1"/>}
                                   {previewData.diff > 0 ? '+' : ''}{formatNumber(previewData.diff)} ₺
                                </span>
                             </div>
                          )}
                          {/* Estimated Realized PL for Sales */}
                          {previewData.estimatedRealizedPL !== null && (
                              <div className="flex items-center justify-between mt-2 pt-2 border-t border-rose-200/50">
                                 <span className="text-[10px] font-bold uppercase tracking-wide text-rose-900">
                                    Realize Edilecek Kar/Zarar
                                 </span>
                                 <span className={`text-xs font-bold ${previewData.estimatedRealizedPL >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                    {previewData.estimatedRealizedPL > 0 ? '+' : ''}{formatCurrency(previewData.estimatedRealizedPL)}
                                 </span>
                              </div>
                          )}
                       </div>
                    )}

                    <Button 
                       type="submit" 
                       className={`w-full flex justify-center items-center gap-2 mt-2 py-2.5 text-sm font-semibold shadow-md transition-all ${transactionType === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100' : 'bg-rose-600 hover:bg-rose-700 shadow-rose-100'}`}
                    >
                       {transactionType === 'BUY' ? <Plus className="w-4 h-4" /> : <Minus className="w-4 h-4" />} 
                       {transactionType === 'BUY' ? 'Ekle' : 'Ekle'}
                    </Button>
                 </form>
              </Card>
           </div>

           {/* Transaction History Compact */}
           <div className="lg:col-span-8">
              <Card title={`Geçmiş (${transactionsWithStats.length})`} className="shadow-lg overflow-hidden border-0 h-full">
                 {transactionsWithStats.length > 0 ? (
                    <div className="overflow-x-auto -mx-3 sm:-mx-4">
                       <table className="min-w-full divide-y divide-gray-100">
                          <thead className="bg-slate-50">
                             <tr>
                                <th className="px-3 py-2 text-left text-[9px] font-bold text-slate-400 uppercase tracking-wider w-8">#</th>
                                <th className="px-3 py-2 text-left text-[9px] font-bold text-slate-400 uppercase tracking-wider">İşlem</th>
                                <th className="px-3 py-2 text-left text-[9px] font-bold text-slate-400 uppercase tracking-wider">Fiyat</th>
                                <th className="px-3 py-2 text-left text-[9px] font-bold text-slate-400 uppercase tracking-wider">Adet</th>
                                <th className="px-3 py-2 text-left text-[9px] font-bold text-slate-400 uppercase tracking-wider">Tutar</th>
                                <th className="px-3 py-2 text-left text-[9px] font-bold text-indigo-600 uppercase tracking-wider bg-indigo-50/30">
                                   {simulationPrice ? 'P/L Analiz' : 'P/L'}
                                </th>
                                <th className="px-3 py-2 text-right w-10"></th>
                             </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-50">
                             {transactionsWithStats.map((t) => {
                                const isActive = t.isActive !== false;
                                const isBuy = t.type === 'BUY';
                                
                                let displayPL = null;
                                let displayPLAmount = 0;
                                let displayPercent = 0;
                                let displayClass = "";
                                let isRealized = false;

                                if (isBuy) {
                                   if (simulationPrice) {
                                      const currentP = parseFloat(simulationPrice);
                                      if (!isNaN(currentP)) {
                                         displayPLAmount = (currentP - t.price) * t.quantity;
                                         displayPL = currentP - t.price;
                                         displayPercent = ((currentP - t.price) / t.price) * 100;
                                         displayClass = displayPLAmount >= 0 ? "text-emerald-700 bg-emerald-50/80 border-emerald-100" : "text-rose-700 bg-rose-50/80 border-rose-100";
                                      }
                                   }
                                } else {
                                   if (t.realizedPL !== null) {
                                      isRealized = true;
                                      displayPLAmount = t.realizedPL;
                                      displayPL = t.realizedPL;
                                      displayPercent = t.realizedPLPercent;
                                      displayClass = displayPLAmount >= 0 ? "text-emerald-700 bg-emerald-50/80 border-emerald-100" : "text-rose-700 bg-rose-50/80 border-rose-100";
                                   }
                                }

                                return (
                                   <tr key={t.id} className={`group transition-all hover:bg-slate-50 ${!isActive ? 'bg-slate-50/50' : ''}`}>
                                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                                         <button 
                                            onClick={() => toggleTransactionStatus(t.id)}
                                            className={`p-1.5 rounded-md transition-all shadow-sm ${isActive ? 'text-indigo-600 bg-white ring-1 ring-indigo-100 hover:ring-indigo-300' : 'text-gray-400 bg-gray-100 hover:bg-gray-200'}`}
                                         >
                                            {isActive ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                         </button>
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${isBuy ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                                            {isBuy ? 'Alış' : 'Satış'}
                                          </span>
                                      </td>
                                      <td className={`px-3 py-2 whitespace-nowrap text-xs sm:text-sm font-bold font-mono ${isActive ? 'text-slate-700' : 'text-slate-400 line-through'}`}>{formatCurrency(t.price)}</td>
                                      <td className={`px-3 py-2 whitespace-nowrap text-xs sm:text-sm font-medium ${isActive ? 'text-slate-600' : 'text-slate-400'}`}>
                                        <span className={isBuy ? '' : 'text-rose-500'}>{isBuy ? '' : '-'}{t.quantity}</span>
                                      </td>
                                      <td className={`px-3 py-2 whitespace-nowrap text-xs sm:text-sm font-medium ${isActive ? 'text-slate-500' : 'text-slate-400'}`}>{formatCurrency(t.price * t.quantity)}</td>
                                      
                                      <td className={`px-3 py-2 whitespace-nowrap`}>
                                         {isBuy && simulationPrice && displayPL !== null ? (
                                            <div className={`inline-flex items-center gap-2 px-2 py-1 rounded border ${isActive ? displayClass : 'text-gray-400 border-transparent'}`}>
                                               <span className="font-bold text-xs">
                                                  {displayPLAmount > 0 ? '+' : ''}{formatCurrency(displayPLAmount)}
                                               </span>
                                               <span className="text-[9px] font-semibold opacity-80 border-l border-current pl-1">
                                                  %{formatNumber(displayPercent)}
                                               </span>
                                            </div>
                                         ) : isRealized && displayPL !== null ? (
                                            <div className="flex flex-col items-start gap-0.5">
                                               <div className={`inline-flex items-center gap-2 px-2 py-1 rounded border ${isActive ? displayClass : 'text-gray-400 border-transparent'}`}>
                                                  <span className="font-bold text-xs">
                                                     {displayPLAmount > 0 ? '+' : ''}{formatCurrency(displayPLAmount)}
                                                  </span>
                                                  <span className="text-[9px] font-semibold opacity-80 border-l border-current pl-1">
                                                     %{formatNumber(displayPercent)}
                                                  </span>
                                               </div>
                                               <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight ml-0.5">Realize Edildi</span>
                                            </div>
                                         ) : (
                                            <span className="text-gray-300 text-xs">-</span>
                                         )}
                                      </td>
                                      
                                      <td className="px-3 py-2 whitespace-nowrap text-right text-sm font-medium">
                                         <button onClick={() => removeTransaction(t.id)} className="text-slate-400 hover:text-rose-600 p-1.5 hover:bg-rose-50 rounded-lg transition-all opacity-100 sm:opacity-0 group-hover:opacity-100 focus:opacity-100">
                                            <Trash2 className="w-3.5 h-3.5" />
                                         </button>
                                      </td>
                                   </tr>
                                );
                             })}
                          </tbody>
                       </table>
                    </div>
                 ) : (
                    <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                       <LayoutList className="w-8 h-8 opacity-30 mb-2" />
                       <p className="font-semibold text-xs text-slate-500">İşlem yok</p>
                    </div>
                 )}
              </Card>
           </div>
        </div>

      </main>

      {/* Undo Toast */}
      {showUndoToast && (
         <div className="fixed bottom-4 right-4 z-50 animate-in fade-in slide-in-from-bottom-5 duration-300">
            <div className="bg-slate-900 text-white pl-4 pr-1 py-1.5 rounded-lg shadow-2xl flex items-center gap-4 border border-slate-700">
               <span className="text-xs font-bold">Silindi</span>
               <button onClick={handleUndoDelete} className="bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1.5 rounded text-xs font-bold transition-colors flex items-center gap-1">
                  <RotateCcw className="w-3 h-3" /> Geri Al
               </button>
            </div>
         </div>
      )}
    </div>
  );
};

export default App;