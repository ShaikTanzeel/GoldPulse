/**
 * Reactive state store for GoldPulse
 * Pure JS Pub-Sub reactive design.
 */

class Store {
  constructor() {
    this.listeners = {};
    
    // Load persisted state or initialize defaults
    this.state = {
      priceData: [],       // Real-time price chart feed (OHLCV list)
      currentPrice: null,   // Latest ticker value
      prevPrice: null,      // Previous ticker value
      spread: 0.15,         // XM typical spread
      signal: {
        signal: 'WAIT',
        score: 0,
        reasons: [],
        metrics: {},
        setup: null,
        levels: []
      },
      timeframe: '15',      // Chart timeframe in minutes
      connected: false,     // MT5 Server link status
      
      // Persisted elements
      apiKeys: (() => {
        const stored = this.loadJson('goldpulse_api_keys', { groq: '', gemini: '' });
        return {
          groq: stored.groq || '',
          gemini: stored.gemini || ''
        };
      })(),
      settings: this.loadJson('goldpulse_settings', {
        balance: 50.00,
        riskPercent: 2.0,
        mt5Server: 'localhost:8765'
      }),
      journal: this.loadJson('goldpulse_journal', []),
      aiHistory: this.loadJson('goldpulse_ai_history', [])
    };
  }

  // Load from localStorage
  loadJson(key, defaultValue) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultValue;
    } catch (e) {
      console.error(`Failed to load ${key} from storage:`, e);
      return defaultValue;
    }
  }

  // Save to localStorage
  saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`Failed to save ${key} to storage:`, e);
    }
  }

  // Retrieve current state item
  get(key) {
    return this.state[key];
  }

  // Update state item and trigger listeners
  set(key, value) {
    this.state[key] = value;
    
    // Persist standard modules
    if (key === 'apiKeys') this.saveJson('goldpulse_api_keys', value);
    if (key === 'settings') this.saveJson('goldpulse_settings', value);
    if (key === 'journal') this.saveJson('goldpulse_journal', value);
    if (key === 'aiHistory') this.saveJson('goldpulse_ai_history', value);
    
    this.emit(key, value);
  }

  // Subscribe to changes of a key
  subscribe(key, callback) {
    if (!this.listeners[key]) {
      this.listeners[key] = [];
    }
    this.listeners[key].push(callback);
    
    // Fire immediately with current value
    callback(this.state[key]);
    
    // Return unsubscribe function
    return () => {
      this.listeners[key] = this.listeners[key].filter(cb => cb !== callback);
    };
  }

  // Trigger reactive listeners
  emit(key, value) {
    if (this.listeners[key]) {
      this.listeners[key].forEach(callback => {
        try {
          callback(value);
        } catch (e) {
          console.error(`Error in store listener for ${key}:`, e);
        }
      });
    }
  }
}

export const store = new Store();
export default store;
