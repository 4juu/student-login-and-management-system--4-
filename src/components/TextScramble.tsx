import React, { useState, useRef, useCallback, useEffect } from 'react';

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";

interface TextScrambleProps {
  text: string;
}

export const TextScramble: React.FC<TextScrambleProps> = ({ text }) => {
  const [displayText, setDisplayText] = useState(text);
  const [isHovering, setIsHovering] = useState(false);
  const [isScrambling, setIsScrambling] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameRef = useRef(0);

  const scramble = useCallback(() => {
    setIsScrambling(true);
    frameRef.current = 0;
    const duration = text.length * 3;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      frameRef.current++;
      const progress = frameRef.current / duration;
      const revealedLength = Math.floor(progress * text.length);
      const newText = text
        .split("")
        .map((char, i) => {
          if (char === " ") return " ";
          if (i < revealedLength) return text[i];
          return CHARS[Math.floor(Math.random() * CHARS.length)];
        })
        .join("");
      setDisplayText(newText);
      if (frameRef.current >= duration) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setDisplayText(text);
        setIsScrambling(false);
      }
    }, 30);
  }, [text]);

  const handleMouseEnter = () => {
    setIsHovering(true);
    scramble();
  };

  const handleMouseLeave = () => {
    setIsHovering(false);
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div
      className="group relative inline-flex flex-col cursor-pointer select-none"
      dir="ltr"
      style={{ unicodeBidi: 'embed' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className="relative font-mono tracking-widest" style={{ fontSize: '0.7rem' }}>
        {displayText.split("").map((char, i) => (
          <span
            key={i}
            className="inline-block transition-all duration-150"
            style={{
              transitionDelay: `${i * 10}ms`,
              color: isScrambling && char !== text[i] ? '#60a5fa' : '#94a3b8',
              transform: isScrambling && char !== text[i] ? 'scale(1.15)' : 'scale(1)',
              fontWeight: isScrambling && char !== text[i] ? 700 : 500,
            }}
          >
            {char}
          </span>
        ))}
      </span>

      {/* Animated underline */}
      <span className="relative h-px w-full mt-1 overflow-hidden">
        <span
          className="absolute inset-0 transition-transform duration-500 ease-out origin-left"
          style={{
            background: '#94a3b8',
            transform: isHovering ? 'scaleX(1)' : 'scaleX(0)',
          }}
        />
        <span className="absolute inset-0" style={{ background: '#1e293b' }} />
      </span>

      {/* Subtle glow on hover */}
      <span
        className="absolute rounded-lg transition-opacity duration-300"
        style={{
          inset: '-12px',
          background: 'rgba(96, 165, 250, 0.05)',
          opacity: isHovering ? 1 : 0,
          zIndex: -1,
        }}
      />
    </div>
  );
};
