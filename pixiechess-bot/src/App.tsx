import GameScreen from './components/GameScreen';
import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
  return (
    <div style={{
      background: '#F4F0FA',
      minHeight: '100vh',
      fontFamily: "'Roboto Condensed', 'Inter', sans-serif",
      color: '#1E1535',
      padding: '24px 16px',
      overflowX: 'hidden',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{
          fontSize: 30,
          fontWeight: 900,
          margin: 0,
          letterSpacing: '-0.5px',
          background: 'linear-gradient(90deg, #7C3AED, #9B6FD4, #6D28D9)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          ✦ PIXIE CHESS ENGINE ✦
        </h1>
        <div style={{
          fontSize: 11,
          color: '#9B90B8',
          letterSpacing: '3px',
          textTransform: 'uppercase',
          marginTop: 6,
          fontFamily: "'Fira Code', monospace",
        }}>
          31 Power Pieces · Stockfish-Level Search · Custom Engine
        </div>
        <div style={{
          fontSize: 11,
          color: '#7C3AED',
          fontWeight: 700,
          marginTop: 8,
          background: 'rgba(124, 58, 237, 0.1)',
          display: 'inline-block',
          padding: '4px 10px',
          borderRadius: 12,
          letterSpacing: '1px'
        }}>
          v3.2.3 (Grandmaster AI + Power Sync)
        </div>
      </div>

      <ErrorBoundary>
        <GameScreen />
      </ErrorBoundary>
    </div>
  );
}

export default App;
