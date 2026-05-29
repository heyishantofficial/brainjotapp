import React, { useEffect, useRef } from 'react';
import faaahSound from '../assets/sounds/confetti/faaah.mp3';

const COLORS = ['#D4FF32', '#FF4C4C', '#4C9EFF', '#FFD700', '#FF69B4', '#00E5CC', '#FF8C00', '#C77DFF'];
const PARTICLE_COUNT = 100;

function randomBetween(a, b) {
  return a + Math.random() * (b - a);
}

export default function ConfettiCelebration({ onDone }) {
  const canvasRef = useRef(null);
  const audioPlayedRef = useRef(false);

  useEffect(() => {
    // 1. Play celebration sound (respects user sound preference)
    if (!audioPlayedRef.current && localStorage.getItem('soundEnabled') !== 'false') {
      const audio = new Audio(faaahSound);
      audio.volume = 0.6;
      audio.play().catch(() => {});
      audioPlayedRef.current = true;
    }

    // 2. Setup Canvas
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 3. Initialize Particles
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: cx + randomBetween(-40, 40),
      y: cy + randomBetween(-40, 40),
      vx: randomBetween(-15, 15),
      vy: randomBetween(-25, -5),
      gravity: randomBetween(0.4, 0.7),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      w: randomBetween(8, 16),
      h: randomBetween(4, 10),
      rotation: randomBetween(0, Math.PI * 2),
      rotationSpeed: randomBetween(-0.15, 0.15),
      opacity: 1,
      shape: Math.random() > 0.5 ? 'rect' : 'circle',
    }));

    // 4. Animation Loop
    let startTime = null;
    const duration = 3000;
    let animId;

    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = elapsed / duration;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach((p) => {
        p.x += p.vx;
        p.vy += p.gravity;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;
        p.opacity = Math.max(0, 1 - progress * 1.2);

        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;

        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      });

      if (progress < 1) {
        animId = requestAnimationFrame(animate);
      } else {
        onDone?.();
      }
    };

    animId = requestAnimationFrame(animate);

    // Fallback: ensure onDone is called even if animation frame fails
    const timeoutId = setTimeout(() => {
      onDone?.();
    }, duration + 500);

    // Cleanup
    return () => {
      clearTimeout(timeoutId);
      if (animId) cancelAnimationFrame(animId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="celebration-container" style={{ position: 'fixed', inset: 0, zIndex: 99999, pointerEvents: 'none' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'celebrate-center 3s ease-out forwards'
      }}>
        <div style={{ fontSize: '100px', filter: 'drop-shadow(0 0 30px rgba(212,255,50,0.6))' }}>🎉</div>
      </div>

    </div>
  );
}
