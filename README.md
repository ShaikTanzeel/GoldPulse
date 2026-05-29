# GoldPulse 📈

GoldPulse is an institutional-grade Forex trading terminal and AI-assisted analytics dashboard tailored exclusively for the XAUUSD (Gold Spot) market. It features a robust Python FastAPI backend for connecting directly to MetaTrader 5 (MT5) and a modern, high-performance Vite/React front-end interface.

## Core Features
- **Real-Time Data Bridge**: Connects seamlessly to a local MT5 instance to stream live ticks and market data.
- **Institutional UI/UX**: Designed with a Deep Space Slate theme, prioritizing clarity, high contrast, and capital preservation.
- **Multi-Timeframe Analysis**: Built-in support for analyzing multiple timeframes (M5, M15, M30, H1, D1) simultaneously.
- **AI-Powered Diagnostics**:
  - **Groq Llama 3.3**: Analyzes technical indicators and price action to determine the optimal trade setup and execution confidence.
  - **Gemini 2.5 Flash**: Conducts multi-timeframe visual chart analysis, highlighting key patterns, Support/Resistance zones, and candlestick structures.

## System Architecture
- **Backend Bridge**: `server/mt5_bridge.py` (FastAPI) acts as the data provider via REST endpoints and WebSockets for live ticks.
- **Frontend App**: Vite + JavaScript/HTML/CSS architecture, state managed by a pure JS Pub-Sub reactive store (`src/data/store.js`).
- **AI Integration**: AI logic is completely isolated in `src/ai/analyzer.js`, allowing for transparent vetoes of indicator signals based on price action logic.

## Prerequisites
- **Node.js**: v18+ (for frontend)
- **Python**: v3.10+ (for MT5 bridge)
- **MetaTrader 5**: Must be installed and running locally with Algo Trading enabled.

## Setup Instructions

### 1. Environment Setup
Copy the `.env.example` file to `.env` and fill in your API keys for the AI analysis capabilities.
```bash
cp .env.example .env
```
*(Note: Your `.env` file is excluded from Git to protect your keys.)*

### 2. Start the Backend (MT5 Bridge)
```bash
# Navigate to the server directory or run directly from root
cd server
python -m venv .venv

# On Windows:
.venv\Scripts\activate
# On Mac/Linux:
source .venv/bin/activate

pip install -r requirements.txt
python mt5_bridge.py
```
The bridge runs on `http://localhost:8765`.

### 3. Start the Frontend
In a new terminal window:
```bash
npm install
npm run dev
```
Navigate to the provided localhost URL (typically `http://localhost:5173`) to view the GoldPulse terminal.

## Disclaimer
GoldPulse is designed for educational and analytical purposes only. It is not financial advice. Trading Forex and CFDs carries a high level of risk and may not be suitable for all investors.
