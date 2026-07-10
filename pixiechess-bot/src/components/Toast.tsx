import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';

export default function Toast() {
  const toastMsg = useGameStore(s => s.toastMsg);
  const clearToast = useGameStore(s => s.clearToast);

  useEffect(() => {
    if (toastMsg) {
      const t = setTimeout(clearToast, 2500);
      return () => clearTimeout(t);
    }
  }, [toastMsg, clearToast]);

  if (!toastMsg) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(30,20,50,0.95)',
      color: '#D4BFE8',
      padding: '10px 24px',
      borderRadius: 8,
      fontSize: 14,
      fontWeight: 600,
      fontFamily: "'Roboto Condensed', 'Inter', sans-serif",
      border: '1px solid #8B6FAE40',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      zIndex: 9999,
      animation: 'toastSlideUp 0.3s ease-out',
      pointerEvents: 'none',
    }}>
      {toastMsg}
    </div>
  );
}
