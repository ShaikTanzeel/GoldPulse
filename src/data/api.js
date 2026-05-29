import { store } from './store.js';

/**
 * Data Integration API for GoldPulse
 * Integrates REST endpoints and WebSocket feeds from local MT5 bridge server.
 */

const getBaseUrl = () => {
  // Use relative proxy path mapped by Vite to bypass local network/CORS issues
  return ''; 
};

const getWsUrl = () => {
  // Use local protocol matching socket
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
};

let wsInstance = null;
let reconnectTimer = null;

export const api = {
  // Fetch historical price bars
  async fetchHistory(timeframeMinutes = 15, count = 300) {
    try {
      const response = await fetch(`${getBaseUrl()}/api/history?timeframe=${timeframeMinutes}&count=${count}`);
      if (!response.ok) throw new Error('MT5 bridge responded with error status');
      const data = await response.json();
      
      // If the response is not an array (e.g., it contains an error object), throw an error
      if (!Array.isArray(data)) {
        if (data && data.error) {
          throw new Error(data.error);
        }
        throw new Error('MT5 bridge did not return a valid data array');
      }
      
      return data;
    } catch (e) {
      console.warn('Could not fetch historical data from MT5 bridge. Using simulated fallback data for offline view.', e);
      return generateSimulatedData(timeframeMinutes, count);
    }
  },

  // Fetch multi-timeframe data for price action analysis (D1, H1, M30, M15, M5, M1)
  async fetchMultiTimeframe() {
    try {
      const response = await fetch(`${getBaseUrl()}/api/multi-timeframe`);
      if (!response.ok) throw new Error('MT5 bridge multi-timeframe request failed');
      const data = await response.json();

      if (data && data.error) {
        throw new Error(data.error);
      }

      // Validate we got data for all timeframes
      const required = ['d1', 'h1', 'm30', 'm15', 'm5', 'm1'];
      for (const tf of required) {
        if (!Array.isArray(data[tf]) || data[tf].length === 0) {
          console.warn(`Multi-timeframe: missing or empty data for ${tf}`);
        }
      }

      return data;
    } catch (e) {
      console.warn('Could not fetch multi-timeframe data. Using simulated fallback.', e);
      return {
        d1:  generateSimulatedData(1440, 60),
        h1:  generateSimulatedData(60, 100),
        m30: generateSimulatedData(30, 120),
        m15: generateSimulatedData(15, 160),
        m5:  generateSimulatedData(5, 200),
        m1:  generateSimulatedData(1, 120)
      };
    }
  },

  // Connect WebSockets to stream live gold ticks
  connectLiveFeed(onPriceUpdate) {
    if (wsInstance) {
      wsInstance.close();
      wsInstance = null;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    try {
      const ws = new WebSocket(getWsUrl());
      wsInstance = ws;

      ws.onopen = () => {
        console.log('Successfully connected to MT5 Bridge Live WebSocket');
        store.set('connected', true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.price) {
            onPriceUpdate(data);
          }
        } catch (err) {
          console.error('Error parsing live WS payload:', err);
        }
      };

      ws.onclose = () => {
        console.warn('MT5 Bridge WebSocket disconnected. Trying to reconnect in 5 seconds...');
        store.set('connected', false);
        wsInstance = null;
        reconnectTimer = setTimeout(() => this.connectLiveFeed(onPriceUpdate), 5000);
      };

      ws.onerror = (e) => {
        console.error('WebSocket encountered an error:', e);
        ws.close();
      };
    } catch (err) {
      console.error('WebSocket connection failed:', err);
      store.set('connected', false);
      reconnectTimer = setTimeout(() => this.connectLiveFeed(onPriceUpdate), 5000);
    }
  },

  disconnectLiveFeed() {
    if (wsInstance) {
      wsInstance.close();
      wsInstance = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    store.set('connected', false);
  }
};

// Generates highly realistic fallback simulated data for testing when MT5 is offline
function generateSimulatedData(timeframe, count) {
  const data = [];
  let basePrice = 2340.50; // Starting baseline gold price
  let time = Math.floor(Date.now() / 1000) - (count * timeframe * 60);

  for (let i = 0; i < count; i++) {
    const volatility = 2.5; // Gold typical 15M volatility
    const rand = Math.random() - 0.49; // Slightly upward bias
    const open = basePrice;
    const close = basePrice + (rand * volatility);
    const high = Math.max(open, close) + (Math.random() * 1.2);
    const low = Math.min(open, close) - (Math.random() * 1.2);
    const volume = Math.floor(Math.random() * 500) + 100;

    data.push({
      time: time,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume: volume
    });

    basePrice = close;
    time += timeframe * 60;
  }
  return data;
}
export default api;
