import { store } from './data/store.js';
import { api } from './data/api.js';
import { generateSignals } from './engine/signals.js';
import { calculateEMA } from './engine/indicators.js';
import { calculatePositionSize, calculateRiskReward } from './engine/riskManager.js';
import { aiAnalyzer } from './ai/analyzer.js';
import { GoldPulseChart } from './components/Chart.js';
import './styles/index.css';

/**
 * Toast Notification System
 * Replaces all alert() calls with elegant, non-blocking toasts.
 */
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-dot"></span><span>${message}</span>`;
  container.appendChild(toast);

  // Auto-remove
  const removeToast = () => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  const timer = setTimeout(removeToast, duration);
  toast.addEventListener('click', () => { clearTimeout(timer); removeToast(); });
}


/**
 * Main Orchestration Logic for GoldPulse SPA
 */

let appChart = null;
let currentOhlcv = [];
let signalHistoryList = [];
let mtfData = null; // Multi-timeframe data for price action analysis (D1, H1, M30, M5)

// Initialize SPA
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  // Check if API Keys are configured locally
  const keys = store.get('apiKeys');
  
  // Also check if backend has them configured securely in its .env
  let backendConfigured = false;
  try {
    const response = await fetch('/api/status');
    if (response.ok) {
      const data = await response.json();
      if (data && data.ai_status && data.ai_status.groq_configured) {
        backendConfigured = true;
      }
    }
  } catch (err) {
    console.warn('Could not contact MT5 bridge status endpoint at startup:', err);
  }

  if ((!keys || !keys.groq) && !backendConfigured) {
    // Hide the loading screen so the setup modal is fully visible and interactive
    const loader = document.getElementById('loadingScreen');
    if (loader) {
      loader.style.opacity = 0;
      setTimeout(() => loader.style.display = 'none', 500);
    }
    document.getElementById('apiSetupModal').style.display = 'flex';
  } else {
    launchApplication();
  }

  // Bind Setup Modal actions
  document.getElementById('saveSetup').addEventListener('click', saveModalConfig);
  document.getElementById('skipSetup').addEventListener('click', () => {
    document.getElementById('apiSetupModal').style.display = 'none';
    launchApplication();
  });

  // Navigation Tab Switching
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      const targetSection = e.currentTarget.getAttribute('data-section');
      switchSection(targetSection);
    });
  });
}

function saveModalConfig() {
  const groq = document.getElementById('groqKey').value.trim();
  const gemini = document.getElementById('geminiKey').value.trim();
  const balance = parseFloat(document.getElementById('accountBalance').value) || 50.00;
  const risk = parseFloat(document.getElementById('riskPercent').value) || 2.0;

  store.set('apiKeys', { groq, gemini });
  
  const currentSettings = store.get('settings');
  store.set('settings', {
    ...currentSettings,
    balance,
    riskPercent: risk
  });

  document.getElementById('apiSetupModal').style.display = 'none';
  launchApplication();
}

function switchSection(sectionId) {
  // Update Navigation Active State
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
  const activeNav = document.getElementById(`nav-${sectionId}`);
  if (activeNav) activeNav.classList.add('active');

  // Use CSS opacity transition instead of display:none toggling
  document.querySelectorAll('.section').forEach(sec => {
    sec.style.display = 'none';
    sec.classList.remove('active');
  });

  const activeSec = document.getElementById(`section-${sectionId}`);
  if (activeSec) {
    activeSec.style.display = 'block';
    // Trigger reflow then add class for fade-in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => activeSec.classList.add('active'));
    });
  }

  // Section-specific data triggers
  if (sectionId === 'journal') {
    renderJournal();
  } else if (sectionId === 'risk') {
    prepopulateRiskCalculator();
  }
}

// Full Application Launch Trigger
async function launchApplication() {
  document.getElementById('app').style.display = 'flex';
  
  // Hide Loading Screen with a smooth fade-out
  const loader = document.getElementById('loadingScreen');
  loader.style.opacity = 0;
  setTimeout(() => loader.style.display = 'none', 500);

  // Initialize TradingView Chart
  appChart = new GoldPulseChart('chartContainer');

  // Subscribe and reflect Reactive Store Elements
  store.subscribe('connected', handleConnectionChange);
  store.subscribe('settings', handleSettingsUpdate);
  
  // Bind UI inputs and buttons
  bindUIEvents();

  // Load baseline candles and begin real-time stream
  await loadPriceHistory();
  
  // Fetch multi-timeframe data for price action analysis
  try {
    mtfData = await api.fetchMultiTimeframe();
    console.log('Multi-timeframe data loaded for price action analysis');
    // Re-process with MTF context
    processMarketData();
  } catch (err) {
    console.warn('Failed to load multi-timeframe data:', err);
  }
  
  api.connectLiveFeed(handleLivePriceTick);
}

function handleConnectionChange(connected) {
  const statusEl = document.getElementById('connectionStatus');
  const dot = statusEl.querySelector('.status-dot');
  const text = statusEl.querySelector('.status-text');

  if (connected) {
    dot.className = 'status-dot connected';
    text.textContent = 'MT5 Connected';
  } else {
    dot.className = 'status-dot disconnected';
    text.textContent = 'MT5 Disconnected';
  }
}

function handleSettingsUpdate(settings) {
  if (settings) {
    document.getElementById('accountDisplay').textContent = `$${settings.balance.toFixed(2)}`;
    
    // Auto-update risk parameters inside fields
    const riskSlider = document.getElementById('riskSlider');
    if (riskSlider) {
      riskSlider.value = settings.riskPercent;
      document.getElementById('riskSliderValue').textContent = settings.riskPercent.toFixed(1);
    }
  }
}

// Load historical data based on timeframe
async function loadPriceHistory() {
  const tf = parseInt(store.get('timeframe')) || 15;
  
  // Update timeframe buttons
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.classList.remove('active');
    if (parseInt(btn.getAttribute('data-tf')) === tf) {
      btn.classList.add('active');
    }
  });

  currentOhlcv = await api.fetchHistory(tf, 250);
  processMarketData();
}

// Recalculate indicators and confluences
function processMarketData() {
  if (!currentOhlcv || currentOhlcv.length === 0) return;

  const closes = currentOhlcv.map(c => c.close);
  const len = closes.length;

  // Calculate moving averages for overlays
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);

  // Process core strategy signals (with multi-timeframe price action if available)
  const signals = generateSignals(currentOhlcv, mtfData);
  store.set('signal', signals);

  // Map EMAs to charting standard (array of { time, value })
  const mappedEma21 = currentOhlcv.map((candle, idx) => ({ time: candle.time, value: ema21[idx] })).filter(d => d.value !== null);
  const mappedEma50 = currentOhlcv.map((candle, idx) => ({ time: candle.time, value: ema50[idx] })).filter(d => d.value !== null);
  const mappedEma200 = currentOhlcv.map((candle, idx) => ({ time: candle.time, value: ema200[idx] })).filter(d => d.value !== null);

  // Refresh TV Candlestick plot
  appChart.updateData(currentOhlcv, {
    ema21: mappedEma21,
    ema50: mappedEma50,
    ema200: mappedEma200
  });

  // Draw detected support/resistance zones
  appChart.drawSupportResistanceLevels(signals.levels);

  // Update UI signal dashboard
  updateSignalUI(signals);
}

// Handle real-time WebSocket ticks
function handleLivePriceTick(tick) {
  if (!currentOhlcv || currentOhlcv.length === 0) return;

  const currentPrice = tick.price;
  const spread = tick.spread || 0.15;
  const timestamp = Math.floor(Date.now() / 1000);
  const tf = parseInt(store.get('timeframe')) || 15;
  const tfSeconds = tf * 60;

  // Price tick flash animation
  const priceEl = document.getElementById('currentPrice');
  const prevPrice = parseFloat(priceEl.textContent.replace(',', '')) || currentPrice;
  const direction = currentPrice >= prevPrice ? 'tick-up' : 'tick-down';
  priceEl.classList.remove('tick-up', 'tick-down');
  // Force reflow to restart animation
  void priceEl.offsetWidth;
  priceEl.classList.add(direction);

  // Update top bar values
  priceEl.textContent = currentPrice.toFixed(2);
  document.getElementById('spreadValue').textContent = `${(spread * 10).toFixed(1)} pips`;
  
  // Calculate price change metrics
  const prevClose = currentOhlcv[currentOhlcv.length - 2]?.close || currentPrice;
  const diff = currentPrice - prevClose;
  const diffPercent = (diff / prevClose) * 100;
  
  const changeEl = document.getElementById('priceChange');
  changeEl.className = diff >= 0 ? 'price-change positive' : 'price-change negative';
  changeEl.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${diffPercent.toFixed(2)}%)`;

  // Dynamically update session indicator based on local hours
  updateSessionIndicator();

  // Handle candle completion logic on the OHLCV array
  const lastCandle = currentOhlcv[currentOhlcv.length - 1];
  
  // If the tick belongs to a new candle period
  if (timestamp - lastCandle.time >= tfSeconds) {
    const newCandle = {
      time: lastCandle.time + tfSeconds,
      open: currentPrice,
      high: currentPrice,
      low: currentPrice,
      close: currentPrice,
      volume: 1
    };
    currentOhlcv.push(newCandle);
    if (currentOhlcv.length > 300) currentOhlcv.shift();
  } else {
    lastCandle.close = currentPrice;
    lastCandle.high = Math.max(lastCandle.high, currentPrice);
    lastCandle.low = Math.min(lastCandle.low, currentPrice);
    lastCandle.volume += 1;
  }

  // Re-run indicators & confluences for live ticks
  processMarketData();
}

function updateSessionIndicator() {
  const localHour = new Date().getHours();
  let sessionName = 'London';
  let dotColor = '#00b0ff'; // default blue

  if (localHour >= 6 && localHour < 14) {
    sessionName = 'Tokyo/Sydney';
    dotColor = '#ff9100'; // Orange
  } else if (localHour >= 14 && localHour < 22) {
    sessionName = 'London';
    dotColor = '#00e676'; // Green
  } else {
    sessionName = 'New York';
    dotColor = '#d4af37'; // Gold
  }

  const indicator = document.getElementById('sessionIndicator');
  indicator.querySelector('.session-name').textContent = sessionName;
  indicator.querySelector('.session-dot').style.backgroundColor = dotColor;
}

// Update dashboard signal views
function updateSignalUI(signals) {
  const badge = document.getElementById('signalBadge');
  const signalClass = signals.signal.replace(/\s+/g, '_'); // "STRONG BUY" → "STRONG_BUY"
  badge.textContent = signals.signal;
  badge.className = `signal-badge-large ${signalClass}`;

  // Update Confluence Gauge slider — mapped from -5 to +5 range into 0%-100%
  const mappedPercent = Math.max(0, Math.min(100, ((signals.score + 5) / 10) * 100));
  document.getElementById('scoreFill').style.width = `${mappedPercent}%`;
  document.getElementById('scoreMarker').style.left = `${mappedPercent}%`;

  // Update indicator readings with dynamic parent container state highlight classes
  const emaEl = document.getElementById('emaTrend');
  const trend = signals.metrics.trend || 'NEUTRAL';
  emaEl.textContent = trend;
  const emaState = trend === 'BULLISH' ? 'bullish' : trend === 'BEARISH' ? 'bearish' : 'neutral';
  emaEl.className = `reading-value ${emaState}`;
  const emaReading = emaEl.closest('.reading');
  if (emaReading) emaReading.className = `reading ${emaState}`;

  const rsi = signals.metrics.rsi;
  const rsiEl = document.getElementById('rsiValue');
  rsiEl.textContent = rsi != null ? rsi.toFixed(1) : '--';
  const rsiState = rsi < 35 ? 'bullish' : rsi > 65 ? 'bearish' : 'neutral';
  rsiEl.className = `reading-value ${rsiState}`;
  const rsiReading = rsiEl.closest('.reading');
  if (rsiReading) rsiReading.className = `reading ${rsiState}`;

  // FIX: use signals.metrics.macd (not .histogram — that field doesn't exist on the return object)
  const macd = signals.metrics.macd;
  const macdEl = document.getElementById('macdValue');
  macdEl.textContent = macd != null ? macd.toFixed(4) : '--';
  const macdState = macd > 0 ? 'bullish' : macd < 0 ? 'bearish' : 'neutral';
  macdEl.className = `reading-value ${macdState}`;
  const macdReading = macdEl.closest('.reading');
  if (macdReading) macdReading.className = `reading ${macdState}`;

  const atrEl = document.getElementById('atrValue');
  atrEl.textContent = signals.metrics.atr != null
    ? `$${signals.metrics.atr.toFixed(2)}`
    : '--';
  const atrReading = atrEl.closest('.reading');
  if (atrReading) atrReading.className = 'reading info';

  // Process Suggested Trade Setup Panel
  if (signals.setup) {
    document.getElementById('setupEntry').textContent = `$${signals.setup.entry.toFixed(2)}`;
    document.getElementById('setupSL').textContent = `$${signals.setup.sl.toFixed(2)}`;
    document.getElementById('setupTP').textContent = `$${signals.setup.tp.toFixed(2)}`;
    document.getElementById('setupRR').textContent = `1 : ${signals.setup.rr.toFixed(1)}`;
    
    const settings = store.get('settings');
    const riskCalc = calculatePositionSize(
      settings.balance,
      settings.riskPercent,
      signals.setup.entry,
      signals.setup.sl
    );

    document.getElementById('setupLot').textContent = riskCalc.lotSize.toFixed(2);
    document.getElementById('setupRiskDollar').textContent = `$${riskCalc.riskAmount.toFixed(2)}`;
    document.getElementById('logTradeBtn').disabled = false;
  } else {
    document.getElementById('setupEntry').textContent = '--';
    document.getElementById('setupSL').textContent = '--';
    document.getElementById('setupTP').textContent = '--';
    document.getElementById('setupLot').textContent = '--';
    document.getElementById('setupRR').textContent = '--';
    document.getElementById('setupRiskDollar').textContent = '--';
    document.getElementById('logTradeBtn').disabled = true;
  }

  // Populate signals detail list
  const detailEl = document.getElementById('signalsDetail');
  if (detailEl) {
    detailEl.innerHTML = signals.reasons.map(reason => `
      <div class="signal-reason">
        <span class="reason-dot">⚡</span>
        <span class="reason-text">${reason}</span>
      </div>
    `).join('') || '<p class="neutral" style="padding:16px;">Waiting for indicator confluences...</p>';
  }

  // Add to signal history list
  const now = new Date();
  const timeStr = now.toTimeString().slice(0, 8);
  const histItem = document.createElement('div');
  histItem.className = 'signal-history-item';
  histItem.innerHTML = `
    <span class="signal-history-time">${timeStr}</span>
    <span class="signal-badge-sm ${signalClass}">${signals.signal}</span>
    <span class="reason-text" style="font-size:0.75rem; color:var(--text-muted); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${signals.setupType !== 'NONE' ? signals.setupType : 'No Setup'}</span>
    <span class="signal-history-score">${signals.score.toFixed(1)}</span>
  `;
  signalHistoryList.unshift(histItem);
  if (signalHistoryList.length > 60) signalHistoryList.pop();

  const histEl = document.getElementById('signalHistory');
  if (histEl) {
    histEl.innerHTML = '';
    signalHistoryList.forEach(item => histEl.appendChild(item.cloneNode(true)));
  }
}

// Prep risk calculator inputs based on live chart price & indicators SL
function prepopulateRiskCalculator() {
  const signal = store.get('signal');
  const settings = store.get('settings');

  document.getElementById('riskBalance').value = settings.balance.toFixed(2);
  
  if (signal && signal.setup) {
    document.getElementById('riskEntry').value = signal.setup.entry.toFixed(2);
    document.getElementById('riskSL').value = signal.setup.sl.toFixed(2);
    document.getElementById('riskTP').value = signal.setup.tp.toFixed(2);
    
    if (signal.signal.includes('SELL')) {
      document.getElementById('dirSell').click();
    } else {
      document.getElementById('dirBuy').click();
    }
  } else if (currentOhlcv.length > 0) {
    const currentPrice = currentOhlcv[currentOhlcv.length - 1].close;
    document.getElementById('riskEntry').value = currentPrice.toFixed(2);
  }
  
  triggerRiskCalculation();
}

function triggerRiskCalculation() {
  const balance = parseFloat(document.getElementById('riskBalance').value) || 50.00;
  const risk = parseFloat(document.getElementById('riskSlider').value) || 2.0;
  const entry = parseFloat(document.getElementById('riskEntry').value) || 0;
  const sl = parseFloat(document.getElementById('riskSL').value) || 0;
  const tp = parseFloat(document.getElementById('riskTP').value) || 0;

  const result = calculatePositionSize(balance, risk, entry, sl);
  const rr = calculateRiskReward(entry, sl, tp, result.lotSize);

  // Render values
  document.getElementById('resultLotSize').textContent = result.lotSize.toFixed(2);
  document.getElementById('resultRiskAmt').textContent = `$${result.riskAmount.toFixed(2)}`;
  document.getElementById('resultSLDist').textContent = `${result.pips || '--'} pips`;
  
  if (rr) {
    document.getElementById('resultRewardAmt').textContent = `$${rr.dollarReward.toFixed(2)}`;
    document.getElementById('resultRR').textContent = `1 : ${rr.rrRatio.toFixed(1)}`;
    document.getElementById('resultTPDist').textContent = `${rr.rewardPips} pips`;
    
    // Draw the risk reward bar
    const totalPips = result.pips + rr.rewardPips;
    const riskPercent = (result.pips / totalPips) * 100;
    const rewardPercent = (rr.rewardPips / totalPips) * 100;
    
    document.getElementById('rrRiskZone').style.width = `${riskPercent}%`;
    document.getElementById('rrRewardZone').style.width = `${rewardPercent}%`;
    
    document.getElementById('rrSLLabel').textContent = `SL $${sl.toFixed(2)}`;
    document.getElementById('rrEntryLabel').textContent = `Entry $${entry.toFixed(2)}`;
    document.getElementById('rrTPLabel').textContent = `TP $${tp.toFixed(2)}`;
  } else {
    document.getElementById('resultRewardAmt').textContent = '--';
    document.getElementById('resultRR').textContent = '--';
    document.getElementById('resultTPDist').textContent = '--';
  }
}

// Bind UI event listeners
function bindUIEvents() {
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('tradeModal').style.display = 'none';
    }
    if (e.altKey && e.key === 'l') {
      e.preventDefault();
      document.getElementById('addTradeBtn').click();
    }
    if (e.altKey && e.key === 'a') {
      e.preventDefault();
      document.getElementById('refreshAI').click();
    }
  });

  // Timeframe selector buttons
  const tfButtons = document.querySelectorAll('.tf-btn');
  tfButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const minutes = e.currentTarget.getAttribute('data-tf');
      store.set('timeframe', minutes);
      loadPriceHistory();
    });
  });

  // Risk Calculator slide changes
  const slider = document.getElementById('riskSlider');
  if (slider) {
    slider.addEventListener('input', (e) => {
      document.getElementById('riskSliderValue').textContent = parseFloat(e.target.value).toFixed(1);
      triggerRiskCalculation();
    });
  }

  const dirButtons = document.querySelectorAll('.dir-btn');
  dirButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      dirButtons.forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      triggerRiskCalculation();
    });
  });

  const inputs = ['riskBalance', 'riskEntry', 'riskSL', 'riskTP'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', triggerRiskCalculation);
  });

  // Quick action to log trade from dashboard
  document.getElementById('logTradeBtn').addEventListener('click', () => {
    const signal = store.get('signal');
    const settings = store.get('settings');
    
    if (signal && signal.setup) {
      const calc = calculatePositionSize(
        settings.balance,
        settings.riskPercent,
        signal.setup.entry,
        signal.setup.sl
      );
      
      document.getElementById('tradeEntry').value = signal.setup.entry.toFixed(2);
      document.getElementById('tradeSL').value = signal.setup.sl.toFixed(2);
      document.getElementById('tradeTP').value = signal.setup.tp.toFixed(2);
      document.getElementById('tradeLot').value = calc.lotSize.toFixed(2);
      
      if (signal.signal.includes('SELL')) {
        document.getElementById('tradeDirSell').click();
      } else {
        document.getElementById('tradeDirBuy').click();
      }
      
      document.getElementById('tradeModal').style.display = 'flex';
    }
  });

  // Trade Modal buttons
  document.getElementById('addTradeBtn').addEventListener('click', () => {
    document.getElementById('tradeEntry').value = '';
    document.getElementById('tradeSL').value = '';
    document.getElementById('tradeTP').value = '';
    document.getElementById('tradeLot').value = '0.01';
    document.getElementById('tradeNotes').value = '';
    document.getElementById('tradeModal').style.display = 'flex';
  });

  document.getElementById('closeTradeModal').addEventListener('click', () => {
    document.getElementById('tradeModal').style.display = 'none';
  });
  document.getElementById('cancelTrade').addEventListener('click', () => {
    document.getElementById('tradeModal').style.display = 'none';
  });

  document.getElementById('saveTrade').addEventListener('click', saveLoggedTrade);

  // AI Buttons trigger
  document.getElementById('refreshAI').addEventListener('click', runAIQuickInsight);
  document.getElementById('runAnalysis').addEventListener('click', runFullAIAnalysis);

  const aiActionButtons = document.querySelectorAll('[data-ai-action]');
  aiActionButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = e.currentTarget.getAttribute('data-ai-action');
      document.getElementById('nav-ai').click();
      runFullAIAnalysis(action);
    });
  });

  // Settings Save trigger
  document.getElementById('saveSettings').addEventListener('click', saveSettingsPanel);

  // Emotion selector
  const emotionBtns = document.querySelectorAll('.emotion-btn');
  emotionBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      emotionBtns.forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
    });
  });
}

// Savelogged trade into local journal array
function saveLoggedTrade() {
  const dir = document.querySelector('#tradeModal .dir-btn.active').getAttribute('data-dir');
  const entry = parseFloat(document.getElementById('tradeEntry').value) || 0;
  const sl = parseFloat(document.getElementById('tradeSL').value) || 0;
  const tp = parseFloat(document.getElementById('tradeTP').value) || 0;
  const lot = parseFloat(document.getElementById('tradeLot').value) || 0.01;
  const status = document.getElementById('tradeStatus').value;
  const closePrice = parseFloat(document.getElementById('tradeClose').value) || null;
  const strategy = document.getElementById('tradeStrategy').value;
  const emotion = document.querySelector('.emotion-btn.active')?.getAttribute('data-emotion') || 'neutral';
  const notes = document.getElementById('tradeNotes').value.trim();

  if (entry === 0) {
    alert('Please enter a valid entry price');
    return;
  }

  // Calculate P&L metrics
  let pnl = 0;
  if (status !== 'open' && closePrice) {
    const goldDiff = dir === 'buy' ? (closePrice - entry) : (entry - closePrice);
    const pipDiff = goldDiff * 10;
    pnl = (lot / 0.01) * pipDiff * 0.01; // XM micro pip value calculation
  }

  const newLog = {
    id: 'trade_' + Date.now(),
    date: new Date().toISOString(),
    direction: dir,
    entry,
    sl,
    tp,
    lot,
    status,
    closePrice,
    pnl: parseFloat(pnl.toFixed(2)),
    strategy,
    emotion,
    notes
  };

  const currentJournal = store.get('journal') || [];
  currentJournal.push(newLog);
  store.set('journal', currentJournal);

  // Deduct/Add money to settings balance if trade is closed
  if (status !== 'open') {
    const settings = store.get('settings');
    store.set('settings', {
      ...settings,
      balance: parseFloat((settings.balance + pnl).toFixed(2))
    });
  }

  document.getElementById('tradeModal').style.display = 'none';
  showToast('Trade logged to journal.', 'success');
  renderJournal();
}

function renderJournal() {
  const journal = store.get('journal') || [];
  const listEl = document.getElementById('tradeList');
  
  if (journal.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📝</span>
        <p>No trades logged yet. Click "Log Manual Trade" to get started.</p>
      </div>
    `;
    // Reset stats
    document.getElementById('totalTrades').textContent = '0';
    document.getElementById('winRate').textContent = '0%';
    document.getElementById('profitFactor').textContent = '0.0';
    document.getElementById('avgRR').textContent = '0.0';
    document.getElementById('netPnL').textContent = '$0.00';
    return;
  }

  // Calculate statistics
  const total = journal.length;
  const closed = journal.filter(t => t.status !== 'open');
  const wins = closed.filter(t => t.status === 'win');
  const losses = closed.filter(t => t.status === 'loss');
  
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const netPnL = closed.reduce((sum, t) => sum + t.pnl, 0);

  // Profit Factor = Gross Profit / Gross Loss
  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  // Average R:R from trades that have valid SL/TP
  const validRR = closed.filter(t => t.sl && t.tp && Math.abs(t.entry - t.sl) > 0);
  const avgRR = validRR.length > 0
    ? validRR.reduce((sum, t) => {
        const risk = Math.abs(t.entry - t.sl);
        const reward = Math.abs(t.tp - t.entry);
        return sum + (reward / risk);
      }, 0) / validRR.length
    : 0;

  // Render stats
  document.getElementById('totalTrades').textContent = total;
  
  const winRateEl = document.getElementById('winRate');
  winRateEl.textContent = `${winRate.toFixed(1)}%`;
  winRateEl.className = `stat-value ${winRate >= 50 ? 'positive' : 'negative'}`;
  
  document.getElementById('profitFactor').textContent = profitFactor > 100 ? '∞' : profitFactor.toFixed(2);
  document.getElementById('profitFactor').className = `stat-value ${profitFactor >= 1 ? 'positive' : 'negative'}`;
  
  document.getElementById('avgRR').textContent = avgRR.toFixed(2);
  document.getElementById('avgRR').className = `stat-value ${avgRR >= 2 ? 'positive' : avgRR >= 1 ? '' : 'negative'}`;
  
  const netPnLEl = document.getElementById('netPnL');
  netPnLEl.textContent = `${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}`;
  netPnLEl.className = `stat-value ${netPnL >= 0 ? 'positive' : 'negative'}`;

  // Render trade list
  listEl.innerHTML = '';
  const trades = [...journal].reverse(); // Most recent first
  trades.forEach(trade => {
    const item = document.createElement('div');
    item.className = 'trade-log-item glass-card';
    const isBuy = trade.direction === 'buy';
    const statusColor = trade.status === 'win' ? 'positive' : trade.status === 'loss' ? 'negative' : '';
    const dirColor = isBuy ? 'var(--color-buy)' : 'var(--color-sell)';

    item.innerHTML = `
      <div class="trade-log-header">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-family:var(--font-sans); font-size:0.72rem; font-weight:800; padding:2px 8px; border-radius:4px; background:${isBuy ? 'var(--color-buy-bg)' : 'var(--color-sell-bg)'}; color:${dirColor}; border:1px solid ${isBuy ? 'rgba(0,230,118,0.3)' : 'rgba(255,23,68,0.3)'}">${trade.direction.toUpperCase()}</span>
          <strong style="font-size:0.9rem;">${trade.lot.toFixed(2)} lots XAUUSD</strong>
          <span style="font-family:var(--font-mono); font-size:0.85rem; color:var(--text-secondary);">@ $${trade.entry.toFixed(2)}</span>
        </div>
        <div class="${statusColor}" style="font-family:var(--font-mono); font-weight:700; font-size:0.95rem;">
          ${trade.status === 'open' ? '<span style="color:var(--color-info)">OPEN</span>' : `${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}`}
        </div>
      </div>
      <div class="trade-log-meta">
        <span>SL: <span style="color:var(--color-sell);font-family:var(--font-mono);">$${trade.sl.toFixed(2)}</span></span>
        <span>TP: <span style="color:var(--color-buy);font-family:var(--font-mono);">$${trade.tp.toFixed(2)}</span></span>
        <span style="text-transform:uppercase;">${trade.strategy}</span>
        <span style="color:var(--text-muted);">🧠 ${trade.emotion}</span>
        <span style="color:var(--text-muted); font-size:0.72rem;">${new Date(trade.date).toLocaleDateString()}</span>
      </div>
      ${trade.notes ? `<div class="trade-log-notes">${trade.notes}</div>` : ''}
    `;
    listEl.appendChild(item);
  });
}

// Settings Saving
function saveSettingsPanel() {
  const groq = document.getElementById('settingsGroqKey').value.trim();
  const gemini = document.getElementById('settingsGeminiKey').value.trim();
  const balance = parseFloat(document.getElementById('settingsBalance').value) || 50.00;
  const risk = parseFloat(document.getElementById('settingsRisk').value) || 2.0;

  store.set('apiKeys', { groq, gemini });
  
  const currentSettings = store.get('settings');
  store.set('settings', {
    ...currentSettings,
    balance,
    riskPercent: risk
  });

  showToast('System settings saved successfully.', 'success');
}

// AI Quick insight triggers (Llama) — now with price action context
async function runAIQuickInsight() {
  const signal = store.get('signal');
  const insightEl = document.getElementById('aiInsight');
  const btn = document.getElementById('refreshAI');

  // Loading state
  btn.classList.add('btn-loading');
  btn.disabled = true;
  insightEl.innerHTML = `
    <div class="skeleton-container">
      <div class="skeleton-line w-full"></div>
      <div class="skeleton-line w-80"></div>
      <div class="skeleton-line w-60"></div>
      <div class="skeleton-line w-45"></div>
    </div>
  `;

  try {
    const rawInsight = await aiAnalyzer.runIndicatorAnalysis(signal);
    const verdict = aiAnalyzer.parseVerdict(rawInsight);
    
    updateVetoPanel(verdict);
    insightEl.innerHTML = `<div class="ai-text-render">${verdict.rawAnalysis.replace(/\n/g, '<br/>')}</div>`;
    showToast(`AI Analysis complete — ${verdict.confidence}% confidence: ${verdict.action}`, 'info');
  } catch (err) {
    insightEl.innerHTML = `<p class="negative" style="padding:8px 0;">⚠️ AI Error: ${err.message}</p>`;
    showToast(`AI Error: ${err.message}`, 'error');
  } finally {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
  }
}

// Full AI reasoning using Llama & Gemini multi-timeframe screenshots
async function runFullAIAnalysis(actionType = 'market') {
  const signal = store.get('signal');
  const outputEl = document.getElementById('aiOutput');
  const btn = document.getElementById('runAnalysis');

  // Loading state on button
  btn.classList.add('btn-loading');
  btn.disabled = true;

  outputEl.innerHTML = `
    <div style="padding: 24px;">
      <div class="skeleton-container">
        <div class="skeleton-line h-tall w-full" style="margin-bottom:16px;"></div>
        <div class="skeleton-line w-full"></div>
        <div class="skeleton-line w-80"></div>
        <div class="skeleton-line w-60"></div>
        <div class="skeleton-line w-full" style="margin-top:16px;"></div>
        <div class="skeleton-line w-45"></div>
        <div class="skeleton-line w-80"></div>
      </div>
      <p style="text-align:center; color:var(--text-muted); font-size:0.78rem; margin-top:16px;">Initializing multi-modal AI engine (Llama 3.3 + Gemini 2.5 Flash)...</p>
    </div>
  `;

  try {
    // Step 1: Groq text analysis with full price action context
    const rawTextInsight = await aiAnalyzer.runIndicatorAnalysis(signal);
    const textVerdict = aiAnalyzer.parseVerdict(rawTextInsight);

    // Step 2: Fetch fresh multi-timeframe data for screenshots
    let freshMtfData = mtfData;
    try {
      freshMtfData = await api.fetchMultiTimeframe();
      mtfData = freshMtfData;
    } catch (e) {
      console.warn('Using cached MTF data for screenshots');
    }

    // Step 3: Capture multi-timeframe screenshots (D1, H1, M30, M5)
    let screenshots = {};
    let visualVerdict = null;
    
    if (freshMtfData) {
      screenshots = await appChart.captureMultiTimeframeScreenshots(freshMtfData);
      const validScreenshots = Object.values(screenshots).filter(s => s !== null).length;
      
      if (validScreenshots > 0) {
        const setupText = `Indicator Signal: ${signal.signal} (Score: ${signal.score.toFixed(1)}) | Trend: ${signal.metrics.trend} | Price: $${signal.metrics.price?.toFixed(2)} | RSI: ${signal.metrics.rsi?.toFixed(1)}`;
        try {
          const rawVisualInsight = await aiAnalyzer.runVisualChartAnalysis(screenshots, setupText);
          visualVerdict = aiAnalyzer.parseVisualVerdict(rawVisualInsight);
        } catch (geminiErr) {
          console.error('Gemini visual analysis failed:', geminiErr);
          showToast('Gemini visual analysis unavailable — using text analysis only.', 'warning');
        }
      }
    }

    // Update veto panel
    updateVetoPanel(textVerdict, visualVerdict);
    showToast(`AI Audit complete — ${textVerdict.confidence}% confidence: ${textVerdict.action}`, textVerdict.override ? 'warning' : 'success');

    // Render combined report
    outputEl.innerHTML = `
      <div style="padding: 20px; line-height: 1.6; max-height: calc(100vh - 200px); overflow-y: auto;">
        <h2 style="color:var(--gold-metallic); margin-bottom: 16px; font-size:1.05rem; letter-spacing:0.5px;">📊 AI STRATEGY CONFLUENCE REPORT</h2>
        
        <!-- AI Decision Summary -->
        <div style="margin-bottom: 18px; padding: 16px; background: rgba(0,0,0,0.4); border-radius: 10px; border: 1px solid ${textVerdict.override ? 'rgba(255,23,68,0.25)' : 'rgba(0,230,118,0.15)'};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h3 style="margin: 0; font-size:0.9rem;">🤖 AI Decision</h3>
            <span style="font-family: var(--font-mono); font-weight: 700; font-size: 1rem; color: ${textVerdict.confidence >= 60 ? 'var(--color-buy)' : textVerdict.confidence >= 40 ? 'var(--color-caution)' : 'var(--color-sell)'}">${textVerdict.confidence}% Confidence</span>
          </div>
          <p style="margin-bottom:6px;"><strong>Indicator Signal:</strong> ${signal.signal} (Score: ${signal.score.toFixed(1)})</p>
          <p style="margin-bottom:6px;"><strong>AI Recommendation:</strong> <span style="font-size: 1.05rem; font-weight: 800; font-family:var(--font-mono);">${textVerdict.action}</span> ${textVerdict.override ? '<span style="color: var(--color-sell); font-weight: 700;"> ⚠️ OVERRIDE</span>' : ''}</p>
          <p style="margin-bottom:6px;"><strong>Price Action Alignment:</strong> <span style="color: ${textVerdict.priceActionAlignment === 'CONFIRMS' ? 'var(--color-buy)' : textVerdict.priceActionAlignment === 'CONTRADICTS' ? 'var(--color-sell)' : 'var(--color-neutral)'}">${textVerdict.priceActionAlignment}</span></p>
          ${textVerdict.override ? `<p style="color: var(--color-sell); margin-top: 6px;"><strong>Override Reason:</strong> ${textVerdict.overrideReason}</p>` : ''}
          ${textVerdict.keyRisk ? `<p style="margin-top: 6px; color:var(--color-sell);"><strong>Key Risk:</strong> ${textVerdict.keyRisk}</p>` : ''}
          ${textVerdict.watchFor ? `<p style="color: var(--color-info);"><strong>Watch For:</strong> ${textVerdict.watchFor}</p>` : ''}
        </div>

        <!-- Groq Analysis -->
        <div style="margin-bottom: 20px; padding: 16px; background: rgba(0,0,0,0.25); border-radius: 10px; border:1px solid var(--border-glass);">
          <h3 style="margin-bottom: 10px; font-size:0.85rem; color:var(--text-secondary);">📈 TECHNICAL + PRICE ACTION ANALYSIS — Llama 3.3</h3>
          <div class="ai-text-render">${textVerdict.rawAnalysis.replace(/\n/g, '<br/>')}</div>
        </div>
        
        ${visualVerdict ? `
          <!-- Gemini Visual Analysis -->
          <div style="padding: 16px; background: rgba(212,175,55,0.04); border: 1px solid var(--border-glass-active); border-radius: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <h3 style="color:var(--gold-metallic); margin: 0; font-size:0.85rem;">👁️ MULTI-TIMEFRAME VISUAL AUDIT — Gemini 2.5 Flash</h3>
              <span style="font-family: var(--font-mono); font-size: 0.8rem; color:var(--text-muted);">Pattern: ${visualVerdict.patternConfidence}%</span>
            </div>
            <p style="margin-bottom:5px;"><strong>Confirms Signal:</strong> <span style="color: ${visualVerdict.confirmsSignal === 'YES' ? 'var(--color-buy)' : visualVerdict.confirmsSignal === 'NO' ? 'var(--color-sell)' : 'var(--color-neutral)'}">${visualVerdict.confirmsSignal}</span></p>
            ${visualVerdict.majorVisualRisk ? `<p style="color: var(--color-sell); margin-bottom:5px;"><strong>Visual Risk:</strong> ${visualVerdict.majorVisualRisk}</p>` : ''}
            ${visualVerdict.recommendation ? `<p style="color: var(--color-info);"><strong>Recommendation:</strong> ${visualVerdict.recommendation}</p>` : ''}
            <hr style="border-color: var(--border-glass); margin: 12px 0;">
            <div class="ai-text-render">${visualVerdict.rawAnalysis.replace(/\n/g, '<br/>')}</div>
          </div>
        ` : `
          <div style="padding: 14px; background: rgba(255,255,255,0.02); border-radius: 8px; text-align: center; color: var(--text-muted); font-size:0.82rem;">
            👁️ Visual chart analysis unavailable — check Gemini API key in Settings.
          </div>
        `}
      </div>
    `;
  } catch (err) {
    outputEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">❌</span>
        <p>Analysis failed: ${err.message}</p>
        <p style="font-size:0.8rem; color:var(--text-muted);">Ensure your Groq and Gemini API keys are configured in Settings.</p>
      </div>
    `;
    showToast(`AI Analysis failed: ${err.message}`, 'error');
  } finally {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
  }
}

// Update the AI Veto panel in the dashboard
function updateVetoPanel(textVerdict, visualVerdict = null) {
  const panel = document.getElementById('aiVetoPanel');
  if (!panel || !textVerdict) return;

  panel.style.display = 'block';

  // Confidence badge
  const confEl = document.getElementById('vetoConfidence');
  confEl.textContent = `${textVerdict.confidence}%`;
  confEl.className = `veto-confidence ${textVerdict.confidence >= 60 ? 'high' : textVerdict.confidence >= 40 ? 'medium' : 'low'}`;

  // Action
  const actionEl = document.getElementById('vetoAction');
  actionEl.textContent = textVerdict.override 
    ? `⚠️ AI OVERRIDE: ${textVerdict.action} (Indicator said: ${store.get('signal')?.signal || '?'})` 
    : `AI Agrees: ${textVerdict.action}`;
  actionEl.className = `veto-action ${textVerdict.override ? 'override' : 'confirms'}`;

  // Alignment
  const alignEl = document.getElementById('vetoAlignment');
  alignEl.textContent = `Price Action: ${textVerdict.priceActionAlignment}`;
  alignEl.className = `veto-alignment ${textVerdict.priceActionAlignment}`;

  // Details
  const detailEl = document.getElementById('vetoDetail');
  let details = '';
  if (textVerdict.override && textVerdict.overrideReason !== 'N/A') {
    details += `<div class="veto-risk">⚠️ ${textVerdict.overrideReason}</div>`;
  }
  if (textVerdict.keyRisk) {
    details += `<div class="veto-risk">Risk: ${textVerdict.keyRisk}</div>`;
  }
  if (textVerdict.watchFor) {
    details += `<div class="veto-watch">👀 ${textVerdict.watchFor}</div>`;
  }
  if (visualVerdict) {
    details += `<div style="margin-top: 6px; color: var(--text-muted);">Visual: ${visualVerdict.confirmsSignal} (${visualVerdict.patternConfidence}% pattern confidence)</div>`;
  }
  detailEl.innerHTML = details;
}
