import { useGameStore } from '../store/gameStore';

const T = {
  card: '#FFFFFF',
  border: '#D4C8EC',
  borderAct: '#8B6FAE',
  textPrimary: '#1E1535',
  textSec: '#6B5F8A',
  textMuted: '#9B90B8',
  accent: '#7C3AED',
  accentSoft: '#EDE9FF',
  btnBg: '#F0EBF8',
  btnBgAct: '#E0D6F7',
  eraserBg: '#FEE2E2',
  eraserBorder: '#EF4444',
};

export default function SettingsModal() {
  const showSettings = useGameStore(s => s.showSettings);
  const setShowSettings = useGameStore(s => s.setShowSettings);
  const autoMove = useGameStore(s => s.autoMove);
  const setAutoMove = useGameStore(s => s.setAutoMove);
  const soundEnabled = useGameStore(s => s.soundEnabled);
  const setSoundEnabled = useGameStore(s => s.setSoundEnabled);

  const thinkTimeMs = useGameStore(s => s.thinkTimeMs);
  const setThinkTimeMs = useGameStore(s => s.setThinkTimeMs);
  const multiPv = useGameStore(s => s.multiPv);
  const setMultiPv = useGameStore(s => s.setMultiPv);
  const botColor = useGameStore(s => s.botColor);
  const setBotColor = useGameStore(s => s.setBotColor);
  const gameState = useGameStore(s => s.gameState);
  const toggleCastling = useGameStore(s => s.toggleCastling);

  if (!showSettings) return null;

  const toggleStyle = (active: boolean): React.CSSProperties => ({
    width: 42, height: 22, borderRadius: 11,
    background: active ? '#7C3AED' : '#D4C8EC',
    border: `1px solid ${active ? '#7C3AED' : '#B0A4CC'}`,
    cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0,
  });

  const dotStyle = (active: boolean): React.CSSProperties => ({
    width: 16, height: 16, borderRadius: '50%',
    background: '#FFF',
    position: 'absolute', top: 2,
    left: active ? 22 : 2,
    transition: 'left 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  });

  const labelStyle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: T.textPrimary };
  const descStyle: React.CSSProperties = { fontSize: 12, color: T.textMuted, lineHeight: 1.5, marginTop: 4 };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div style={{
        background: T.card, border: `1px solid ${T.border}`, borderRadius: 14,
        padding: '28px 32px', width: 520, maxWidth: '90vw', maxHeight: '80vh',
        overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: T.textPrimary }}>⚙ Settings</h2>
          <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Active Color */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Active Color (Bot)</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            {(['w', 'b'] as const).map(c => (
              <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: T.textPrimary, cursor: 'pointer' }}>
                <input type="radio" name="botColor" value={c} checked={botColor === c} onChange={() => setBotColor(c)} style={{ accentColor: T.accent }} />
                {c === 'w' ? 'White' : 'Black'}
              </label>
            ))}
          </div>
          <div style={descStyle}>Only the active color's pieces will be calculated when you click Calculate.</div>
        </div>

        {/* Think Time */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Think Time: <span style={{ color: T.accent }}>{thinkTimeMs < 1000 ? `${thinkTimeMs}ms` : `${(thinkTimeMs / 1000).toFixed(1)}s`}</span></div>
          {(() => {
            const times = [100, 500, 750, 1000, 2000, 3000, 5000, 8000, 10000];
            let currentIndex = times.indexOf(thinkTimeMs);
            if (currentIndex === -1) currentIndex = times.findIndex(t => t >= thinkTimeMs);
            if (currentIndex === -1) currentIndex = times.length - 1;
            
            return (
              <input type="range" min={0} max={times.length - 1} step={1} value={currentIndex} 
                onChange={e => setThinkTimeMs(times[+e.target.value])}
                style={{ width: '100%', marginTop: 8, accentColor: T.accent }} />
            );
          })()}
          <div style={descStyle}>Engines calculate by searching ahead several moves "deep". The more time the engine has, the deeper it can search to find a stronger move.</div>
        </div>

        {/* Multi-PV */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Multi-PV (Alternative Lines)</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {[1, 2, 3, 4].map(val => (
              <button
                key={val}
                onClick={() => setMultiPv(val)}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 6,
                  border: `1px solid ${multiPv === val ? T.accent : T.border}`,
                  background: multiPv === val ? T.accentSoft : '#FFF',
                  color: multiPv === val ? T.accent : T.textSec,
                  fontWeight: multiPv === val ? 800 : 600,
                  fontSize: 13, cursor: 'pointer', transition: 'all 0.2s',
                  fontFamily: "'Inter', sans-serif"
                }}
              >
                {val} Line{val > 1 ? 's' : ''}
              </button>
            ))}
          </div>
          <div style={descStyle}>Calculates multiple alternative top moves. Higher Multi-PV slows down the overall depth but gives you more options to choose from.</div>
        </div>

        {/* Auto Move */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
          <div onClick={() => setAutoMove(!autoMove)} style={toggleStyle(autoMove)}>
            <div style={dotStyle(autoMove)} />
          </div>
          <div>
            <div style={labelStyle}>Move Automatically</div>
            <div style={descStyle}>Automatically apply the best move to the board after calculation finishes.</div>
          </div>
        </div>

        {/* Sound Effects */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
          <div onClick={() => setSoundEnabled(!soundEnabled)} style={toggleStyle(soundEnabled)}>
            <div style={dotStyle(soundEnabled)} />
          </div>
          <div>
            <div style={labelStyle}>Sound Effects</div>
            <div style={descStyle}>Play subtle, procedurally generated sound effects for moves and abilities.</div>
          </div>
        </div>

        {/* Castling */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Castling Availability</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            {(['K', 'Q', 'k', 'q'] as const).map(right => (
              <label key={right} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: T.textPrimary, cursor: 'pointer' }}>
                <input type="checkbox" checked={gameState.castling?.[right] ?? true} onChange={() => toggleCastling(right)} style={{ accentColor: T.accent }} />
                {right === 'K' ? 'White K-side' : right === 'Q' ? 'White Q-side' : right === 'k' ? 'Black K-side' : 'Black Q-side'}
              </label>
            ))}
          </div>
          <div style={descStyle}>Check these if castling is still legal.</div>
        </div>

        {/* Done */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
          <button onClick={() => setShowSettings(false)} style={{
            background: T.accent, border: 'none', borderRadius: 6,
            padding: '8px 20px', color: '#FFF', fontWeight: 700, fontSize: 14,
            cursor: 'pointer', fontFamily: "'Inter', sans-serif",
          }}>Done</button>
        </div>
      </div>
    </div>
  );
}
