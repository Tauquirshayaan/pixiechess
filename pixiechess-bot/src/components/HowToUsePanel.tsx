export default function HowToUsePanel() {
  return (
    <div style={{
      background: '#1A1428',
      border: '1px solid #3D2E5C',
      borderRadius: 10,
      padding: 12,
      fontSize: 11,
      color: '#9B7EC8',
      lineHeight: 1.9,
      fontFamily: "'Courier New', monospace",
    }}>
      <div style={{ color: '#C084FC', fontWeight: 900, marginBottom: 5, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase' }}>
        How To Use
      </div>
      <div>① Select piece → click board to place</div>
      <div>② Assign <span style={{ color: '#FBBF24' }}>power pieces</span> to upgrade your army</div>
      <div>③ Open <span style={{ color: '#A78BFA' }}>⚙ Settings</span> to set Bot color + depth</div>
      <div>④ Click <span style={{ color: '#D4BFE8' }}>⚡ CALCULATE</span> to get best move</div>
      <div>⑤ Copy move to your real PixieChess game</div>
      <div style={{ marginTop: 6, color: '#7C6F99' }}>Depth 3 = fast · Depth 4 = slower but stronger</div>
    </div>
  );
}
