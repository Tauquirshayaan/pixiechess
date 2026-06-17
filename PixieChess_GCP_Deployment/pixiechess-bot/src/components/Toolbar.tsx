import { useGameStore } from '../store/gameStore';

// Light theme palette constants
const T = {
  bg: '#F4F0FA',
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
};

const btnStyle = (active: boolean): React.CSSProperties => ({
  background: active ? T.btnBgAct : T.btnBg,
  border: `1px solid ${active ? T.borderAct : T.border}`,
  borderRadius: 6,
  color: active ? T.accent : T.textPrimary,
  cursor: 'pointer',
  fontFamily: "'Roboto Condensed', 'Inter', sans-serif",
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 600,
  transition: 'all .15s',
  whiteSpace: 'nowrap' as const,
  display: 'flex',
  alignItems: 'center',
  gap: 5,
});

export default function Toolbar() {
  const loadStandardBoard = useGameStore(s => s.loadStandardBoard);
  const clearBoard = useGameStore(s => s.clearBoard);
  const toggleFlip = useGameStore(s => s.toggleFlip);
  const setShowSettings = useGameStore(s => s.setShowSettings);
  const showToast = useGameStore(s => s.showToast);
  const botColor = useGameStore(s => s.botColor);

  const handleReset = () => { loadStandardBoard(); showToast('Board reset to starting position'); };
  const handleClear = () => { clearBoard(); showToast('Board cleared'); };
  const handleFlip = () => { toggleFlip(); showToast('Board flipped'); };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <button onClick={handleReset} style={btnStyle(false)}>↺ Reset</button>
      <button onClick={handleClear} style={btnStyle(false)}>🗑 Clear</button>
      <button onClick={handleFlip} style={btnStyle(false)}>⇅ Flip</button>

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{
          fontSize: 12,
          color: T.textSec,
          background: T.btnBg,
          border: `1px solid ${T.border}`,
          borderRadius: 6,
          padding: '6px 10px',
          fontFamily: "'Fira Code', monospace",
        }}>
          Bot: <span style={{ color: T.accent, fontWeight: 700 }}>{botColor === 'w' ? 'White' : 'Black'}</span>
        </div>

        <button
          onClick={() => setShowSettings(true)}
          style={{ ...btnStyle(false), padding: '7px 10px', fontSize: 16 }}
          title="Settings"
        >⚙</button>
      </div>
    </div>
  );
}
