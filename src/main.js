import { store } from './data/store.js';
import { api } from './data/api.js';
import { generateSignals } from './engine/signals.js';
import { calculateEMA } from './engine/indicators.js';
import { calculatePositionSize, calculateRiskReward } from './engine/riskManager.js';
import { aiAnalyzer } from './ai/analyzer.js';
import { GoldPulseChart } from './components/Chart.js';
import './styles/index.css';

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

function initApp() {
  // Check if API Keys are configured, otherwise trigger Setup Modal
  const keys = store.get('apiKeys');
  if (!keys || !keys.groq) {
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

  // Hide All Sections
  document.querySelectorAll('.section').forEach(sec => {
    sec.style.display = 'none';
    sec.classList.remove('active');
  });

  // Show Selected Section
  const activeSec = document.getElementById(`section-${sectionId}`);
  if (activeSec) {
    activeSec.style.display = 'block';
    setTimeout(() => activeSec.classList.add('active'), 50);
  }

  // Perform custom triggers for specific sections
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

  // Update top bar ticks
  document.getElementById('currentPrice').textContent = currentPrice.toFixed(2);
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
    if (currentOhlcv.length > 300) currentOhlcv.shift(); // Keep standard buffer
  } else {
    // Update current active candle metrics
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
  badge.textContent = signals.signal;
  badge.className = `signal-badge-large ${signals.signal.replace(' ', '_')}`;

  // Update Confluence Gauge slider
  // Mapped from -5 to +5 range into 0% - 100% slider
  const mappedPercent = ((signals.score + 5) / 10) * 100;
  document.getElementById('scoreFill').style.width = `${mappedPercent}%`;
  document.getElementById('scoreMarker').style.left = `${mappedPercent}%`;

  // Update indicators dashboard values
  const emaEl = document.getElementById('emaTrend');
  emaEl.textContent = signals.metrics.trend || 'NEUTRAL';
  emaEl.className = `reading-value ${signals.metrics.trend.toLowerCase()}`;

  document.getElementById('rsiValue').textContent = signals.metrics.rsi?.toFixed(1) || '--';
  document.getElementById('macdValue').textContent = signals.metrics.histogram?.toFixed(3) || '--';
  document.getElementById('atrValue').textContent = `$${signals.metrics.atr?.toFixed(2) || '--'}`;

  // Process Suggested Trade Setup Panel
  if (signals.setup) {
    document.getElementById('setupEntry').textContent = `$${signals.setup.entry.toFixed(2)}`;
    document.getElementById('setupSL').textContent = `$${signals.setup.sl.toFixed(2)}`;
    document.getElementById('setupTP').textContent = `$${signals.setup.tp.toFixed(2)}`;
    document.getElementById('setupRR').textContent = `1 : ${signals.setup.rr.toFixed(1)}`;
    
    // Auto-calculate risk with lot sizing rules for dashboard quick setup
    const settings = store.get('settings');
    const riskCalc = calculatePositionSize(
      settings.balance,
      settings.riskPercent,
      signals.setup.entry,
      signals.setup.sl
    );

    document.getElementById('setupLot').textContent = riskCalc.lotSize;
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

  // Populate signals detailed list
  const detailEl = document.getElementById('signalsDetail');
  if (detailEl) {
    detailEl.innerHTML = signals.reasons.map(reason => `
      <div class="signal-reason">
        <span class="reason-dot">⚡</span>
        <span class="reason-text">${reason}</span>
      </div>
    `).join('') || '<p class="neutral">Waiting for indicator confluences...</p>';
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
      
      // Auto fill new trade modal values
      document.getElementById('tradeEntry').value = signal.setup.entry.toFixed(2);
      document.getElementById('tradeSL').value = signal.setup.sl.toFixed(2);
      document.getElementById('tradeTP').value = signal.setup.tp.toFixed(2);
      document.getElementById('tradeLot').value = calc.lotSize;
      
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
    // Reset modal fields for new manual trade
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
  renderJournal();
}

function renderJournal() {
  const journal = store.get('journal') || [];
  const listEl = document.getElementById('tradeList');
  
  if (journal.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📝</span>
        <p>No trades logged yet. Click "+ New Trade" to get started.</p>
      </div>
    `;
    return;
  }

  // Calculate statistics
  const total = journal.length;
  const closed = journal.filter(t => t.status !== 'open');
  const wins = closed.filter(t => t.status === 'win');
  const losses = closed.filter(t => t.status === 'loss');
  
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  
  const netPnL = closed.reduce((sum, t) => sum + t.pnl, 0);
  
  // Render stats counters
  document.getElementById('totalTrades').textContent = total;
  document.getElementById('winRate').textContent = `${winRate.toFixed(1)}%`;
  document.getElementById('netPnL').textContent = `${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}`;
  document.getElementById('netPnL').className = `stat-value ${netPnL >= 0 ? 'positive' : 'negative'}`;

  // Render list items
  listEl.innerHTML = journal.map(trade => `
    <div class="trade-log-item glass-card" style="margin-bottom: 12px; padding: 16px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <span class="badge ${trade.direction === 'buy' ? 'badge-free' : 'btn-danger'}" style="margin-right: 8px;">${trade.direction.toUpperCase()}</span>
          <strong>${trade.lot.toFixed(2)} lots</strong> XAUUSD @ $${trade.entry.toFixed(2)}
        </div>
        <div class="${trade.pnl >= 0 ? 'positive' : 'negative'}" style="font-weight: 700;">
          ${trade.status === 'open' ? 'OPEN' : `${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}`}
        </div>
      </div>
      <div style="margin-top: 8px; font-size: 0.8rem; color: var(--text-secondary); display:flex; gap: 20px;">
        <span>SL: $${trade.sl.toFixed(2)}</span>
        <span>TP: $${trade.tp.toFixed(2)}</span>
        <span>Strategy: ${trade.strategy.toUpperCase()}</span>
        <span>Emotion: ${trade.emotion}</span>
      </div>
      ${trade.notes ? `<div style="margin-top: 10px; font-size: 0.85rem; font-style: italic; color: var(--text-muted); border-left: 2px solid var(--border-glass); padding-left: 10px;">${trade.notes}</div>` : ''}
    </div>
  `).join('');
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

  alert('Settings successfully saved!');
}

// AI Quick insight triggers (Llama) — now with price action context
async function runAIQuickInsight() {
  const signal = store.get('signal');
  const insightEl = document.getElementById('aiInsight');
  
  insightEl.innerHTML = '<p class="neutral">Analyzing confluences, price action, and multi-timeframe structure using Llama 3.3...</p>';

  try {
    const rawInsight = await aiAnalyzer.runIndicatorAnalysis(signal);
    // Parse verdict for veto panel
    const verdict = aiAnalyzer.parseVerdict(rawInsight);
    
    // Update veto panel
    updateVetoPanel(verdict);
    
    // Display analysis text
    insightEl.innerHTML = `<div class="ai-text-render">${verdict.rawAnalysis.replace(/\n/g, '<br/>')}</div>`;
  } catch (err) {
    insightEl.innerHTML = `<p class="negative">AI Error: ${err.message}</p>`;
  }
}

// Full AI reasoning using Llama & Gemini multi-timeframe screenshots
async function runFullAIAnalysis(actionType = 'market') {
  const signal = store.get('signal');
  const outputEl = document.getElementById('aiOutput');

  outputEl.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height: 100%; gap: 16px;">
      <div class="pulse-ring" style="position:relative; width: 60px; height: 60px;"></div>
      <p>Initiating AI Multi-Modal Engine (Llama 3.3 + Gemini 2.5 Flash)...</p>
      <p style="font-size: 0.8rem; color: var(--text-muted);">Step 1/4: Analyzing indicators + price action context...</p>
    </div>
  `;

  try {
    // Step 1: Groq text analysis with full price action context
    const rawTextInsight = await aiAnalyzer.runIndicatorAnalysis(signal);
    const textVerdict = aiAnalyzer.parseVerdict(rawTextInsight);

    // Step 2: Fetch fresh multi-timeframe data for screenshots
    outputEl.querySelector('p:last-child').textContent = 'Step 2/4: Fetching multi-timeframe chart data...';
    let freshMtfData = mtfData;
    try {
      freshMtfData = await api.fetchMultiTimeframe();
      mtfData = freshMtfData;
    } catch (e) {
      console.warn('Using cached MTF data for screenshots');
    }

    // Step 3: Capture multi-timeframe screenshots (D1, H1, M30, M5)
    outputEl.querySelector('p:last-child').textContent = 'Step 3/4: Rendering & capturing D1, H1, M30, M5 charts...';
    let screenshots = {};
    let visualVerdict = null;
    
    if (freshMtfData) {
      screenshots = await appChart.captureMultiTimeframeScreenshots(freshMtfData);
      const validScreenshots = Object.values(screenshots).filter(s => s !== null).length;
      
      if (validScreenshots > 0) {
        // Step 4: Gemini visual analysis
        outputEl.querySelector('p:last-child').textContent = `Step 4/4: Gemini 2.5 Flash analyzing ${validScreenshots} timeframe charts...`;
        const setupText = `Indicator Signal: ${signal.signal} (Score: ${signal.score.toFixed(1)}) | Trend: ${signal.metrics.trend} | Price: $${signal.metrics.price?.toFixed(2)} | RSI: ${signal.metrics.rsi?.toFixed(1)}`;
        
        try {
          const rawVisualInsight = await aiAnalyzer.runVisualChartAnalysis(screenshots, setupText);
          visualVerdict = aiAnalyzer.parseVisualVerdict(rawVisualInsight);
        } catch (geminiErr) {
          console.error('Gemini visual analysis failed:', geminiErr);
        }
      } else {
        console.warn('No valid screenshots captured for Gemini analysis');
      }
    }

    // Update veto panel with combined verdict
    updateVetoPanel(textVerdict, visualVerdict);

    // Render combined report
    outputEl.innerHTML = `
      <div style="padding: 20px; line-height: 1.6; max-height: calc(100vh - 200px); overflow-y: auto;">
        <h2 style="color:var(--gold-metallic); margin-bottom: 16px;">📊 AI Strategy Confluence Report</h2>
        
        <!-- AI Decision Summary -->
        <div style="margin-bottom: 20px; padding: 16px; background: rgba(0,0,0,0.4); border-radius: 8px; border: 1px solid ${textVerdict.override ? 'var(--color-sell)' : 'var(--color-buy)'}; border-opacity: 0.3;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h3 style="margin: 0;">🤖 AI Decision</h3>
            <span style="font-family: var(--font-mono); font-weight: 700; font-size: 1.1rem; color: ${textVerdict.confidence >= 60 ? 'var(--color-buy)' : textVerdict.confidence >= 40 ? '#ffc107' : 'var(--color-sell)'}">${textVerdict.confidence}% Confidence</span>
          </div>
          <p><strong>Indicator Signal:</strong> ${signal.signal} (Score: ${signal.score.toFixed(1)})</p>
          <p><strong>AI Recommendation:</strong> <span style="font-size: 1.1rem; font-weight: 800;">${textVerdict.action}</span> ${textVerdict.override ? '<span style="color: var(--color-sell); font-weight: 700;"> ⚠️ OVERRIDE</span>' : ''}</p>
          <p><strong>Price Action Alignment:</strong> <span style="color: ${textVerdict.priceActionAlignment === 'CONFIRMS' ? 'var(--color-buy)' : textVerdict.priceActionAlignment === 'CONTRADICTS' ? 'var(--color-sell)' : 'var(--color-neutral)'}">${textVerdict.priceActionAlignment}</span></p>
          ${textVerdict.override ? `<p style="color: var(--color-sell); margin-top: 6px;"><strong>Override Reason:</strong> ${textVerdict.overrideReason}</p>` : ''}
          ${textVerdict.keyRisk ? `<p style="margin-top: 6px;"><strong>Key Risk:</strong> ${textVerdict.keyRisk}</p>` : ''}
          ${textVerdict.watchFor ? `<p style="color: var(--color-info);"><strong>Watch For:</strong> ${textVerdict.watchFor}</p>` : ''}
        </div>

        <!-- Groq Analysis -->
        <div style="margin-bottom: 24px; padding: 16px; background: rgba(0,0,0,0.3); border-radius: 8px;">
          <h3 style="margin-bottom: 10px;">📈 Technical + Price Action Analysis (Llama 3.3)</h3>
          <p>${textVerdict.rawAnalysis.replace(/\n/g, '<br/>')}</p>
        </div>
        
        ${visualVerdict ? `
          <!-- Gemini Visual Analysis -->
          <div style="padding: 16px; background: rgba(212,175,55,0.05); border: 1px solid var(--border-glass-active); border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <h3 style="color:var(--gold-metallic); margin: 0;">👁️ Multi-Timeframe Visual Audit (Gemini 2.5 Flash)</h3>
              <span style="font-family: var(--font-mono); font-size: 0.85rem;">Pattern Confidence: ${visualVerdict.patternConfidence}%</span>
            </div>
            <p><strong>Confirms Signal:</strong> <span style="color: ${visualVerdict.confirmsSignal === 'YES' ? 'var(--color-buy)' : visualVerdict.confirmsSignal === 'NO' ? 'var(--color-sell)' : 'var(--color-neutral)'}">${visualVerdict.confirmsSignal}</span></p>
            ${visualVerdict.majorVisualRisk ? `<p style="color: var(--color-sell);"><strong>Visual Risk:</strong> ${visualVerdict.majorVisualRisk}</p>` : ''}
            ${visualVerdict.recommendation ? `<p style="color: var(--color-info);"><strong>Recommendation:</strong> ${visualVerdict.recommendation}</p>` : ''}
            <hr style="border-color: var(--border-glass); margin: 12px 0;">
            <p>${visualVerdict.rawAnalysis.replace(/\n/g, '<br/>')}</p>
          </div>
        ` : `
          <div style="padding: 16px; background: rgba(255,255,255,0.02); border-radius: 8px; text-align: center; color: var(--text-muted);">
            <p>👁️ Visual chart analysis unavailable — Gemini API key may be missing or screenshot capture failed.</p>
          </div>
        `}
      </div>
    `;
  } catch (err) {
    outputEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">❌</span>
        <p>Analysis failed: ${err.message}</p>
        <p style="font-size:0.8rem; color:var(--text-muted);">Ensure your free Groq and Gemini API keys are entered correctly in Settings.</p>
      </div>
    `;
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
