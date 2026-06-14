import { useGameStore } from '../store/gameStore';

const T = { card: '#FFFFFF', border: '#D4C8EC', borderAct: '#7C3AED', textPrimary: '#1E1535', accent: '#7C3AED', btnAct: '#EDE9FF' };

export default function ActiveColorPanel() {
  const botColor = useGameStore(s => s.botColor);
  const setBotColor = useGameStore(s => s.setBotColor);

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: T.accent, letterSpacing: 2, textTransform: 'uppercase' }}>Active Color</div>
      <div style={{ display: 'flex', gap: 12 }}>
        {(['w', 'b'] as const).map(c => (
          <label key={c} style={{
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
            color: botColor === c ? T.accent : T.textPrimary, cursor: 'pointer',
            background: botColor === c ? T.btnAct : 'transparent',
            padding: '6px 12px', borderRadius: 6,
            border: `1px solid ${botColor === c ? T.borderAct : 'transparent'}`,
            transition: 'all 0.2s', flex: 1,
          }}>
            <input type="radio" name="activeColorSidebar" value={c} checked={botColor === c} onChange={() => setBotColor(c)} style={{ accentColor: T.accent }} />
            {c === 'w' ? 'White' : 'Black'}
          </label>
        ))}
      </div>
    </div>
  );
}
