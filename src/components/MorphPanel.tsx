import React from "react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"

const orbStyleId = "color-orb-styles"

function useOrbStyles() {
  React.useEffect(() => {
    if (document.getElementById(orbStyleId)) return
    const style = document.createElement("style")
    style.id = orbStyleId
    style.textContent = `
      @property --angle {
        syntax: "<angle>";
        inherits: false;
        initial-value: 0deg;
      }

      .color-orb {
        display: grid;
        grid-template-areas: "stack";
        overflow: hidden;
        border-radius: 50%;
        position: relative;
        transform: scale(1.1);
      }

      .color-orb::before,
      .color-orb::after {
        content: "";
        display: block;
        grid-area: stack;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        transform: translateZ(0);
      }

      .color-orb::before {
        background:
          conic-gradient(
            from calc(var(--angle) * 2) at 25% 70%,
            var(--accent3),
            transparent 20% 80%,
            var(--accent3)
          ),
          conic-gradient(
            from calc(var(--angle) * 2) at 45% 75%,
            var(--accent2),
            transparent 30% 60%,
            var(--accent2)
          ),
          conic-gradient(
            from calc(var(--angle) * -3) at 80% 20%,
            var(--accent1),
            transparent 40% 60%,
            var(--accent1)
          ),
          conic-gradient(
            from calc(var(--angle) * 2) at 15% 5%,
            var(--accent2),
            transparent 10% 90%,
            var(--accent2)
          ),
          conic-gradient(
            from calc(var(--angle) * 1) at 20% 80%,
            var(--accent1),
            transparent 10% 90%,
            var(--accent1)
          ),
          conic-gradient(
            from calc(var(--angle) * -2) at 85% 10%,
            var(--accent3),
            transparent 20% 80%,
            var(--accent3)
          );
        box-shadow: inset var(--base) 0 0 var(--shadow) calc(var(--shadow) * 0.2);
        filter: blur(var(--blur)) contrast(var(--contrast));
        animation: color-orb-spin var(--spin-duration) linear infinite;
      }

      .color-orb::after {
        background-image: radial-gradient(
          circle at center,
          var(--base) var(--dot),
          transparent var(--dot)
        );
        background-size: calc(var(--dot) * 2) calc(var(--dot) * 2);
        backdrop-filter: blur(calc(var(--blur) * 2)) contrast(calc(var(--contrast) * 2));
        mix-blend-mode: overlay;
      }

      .color-orb[style*="--mask: 0%"]::after {
        mask-image: none;
      }

      .color-orb:not([style*="--mask: 0%"])::after {
        mask-image: radial-gradient(black var(--mask), transparent 75%);
      }

      @keyframes color-orb-spin {
        to {
          --angle: 360deg;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .color-orb::before {
          animation: none;
        }
      }
    `
    document.head.appendChild(style)
  }, [])
}

interface OrbProps {
  dimension?: string
  className?: string
  tones?: {
    base?: string
    accent1?: string
    accent2?: string
    accent3?: string
  }
  spinDuration?: number
}

const ColorOrb: React.FC<OrbProps> = ({
  dimension = "192px",
  className,
  tones,
  spinDuration = 20,
}) => {
  useOrbStyles()

  const fallbackTones = {
    base: "oklch(95% 0.02 264.695)",
    accent1: "oklch(75% 0.15 350)",
    accent2: "oklch(80% 0.12 200)",
    accent3: "oklch(78% 0.14 280)",
  }

  const palette = { ...fallbackTones, ...tones }

  const dimValue = parseInt(dimension.replace("px", ""), 10)

  const blurStrength =
    dimValue < 50 ? Math.max(dimValue * 0.008, 1) : Math.max(dimValue * 0.015, 4)

  const contrastStrength =
    dimValue < 50 ? Math.max(dimValue * 0.004, 1.2) : Math.max(dimValue * 0.008, 1.5)

  const pixelDot = dimValue < 50 ? Math.max(dimValue * 0.004, 0.05) : Math.max(dimValue * 0.008, 0.1)

  const shadowRange = dimValue < 50 ? Math.max(dimValue * 0.004, 0.5) : Math.max(dimValue * 0.008, 2)

  const maskRadius =
    dimValue < 30 ? "0%" : dimValue < 50 ? "5%" : dimValue < 100 ? "15%" : "25%"

  const adjustedContrast =
    dimValue < 30 ? 1.1 : dimValue < 50 ? Math.max(contrastStrength * 1.2, 1.3) : contrastStrength

  return (
    <div
      className={cn("color-orb", className)}
      style={{
        width: dimension,
        height: dimension,
        "--base": palette.base,
        "--accent1": palette.accent1,
        "--accent2": palette.accent2,
        "--accent3": palette.accent3,
        "--spin-duration": `${spinDuration}s`,
        "--blur": `${blurStrength}px`,
        "--contrast": adjustedContrast,
        "--dot": `${pixelDot}px`,
        "--shadow": `${shadowRange}px`,
        "--mask": maskRadius,
      } as React.CSSProperties}
    />
  )
}

interface MorphPanelProps {
  isExpanded: boolean
  onToggle: () => void
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  isTyping: boolean
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  className?: string
}

export function MorphPanel({
  isExpanded,
  onToggle,
  input,
  onInputChange,
  onSend,
  isTyping,
  inputRef,
  onKeyDown,
  className,
}: MorphPanelProps) {
  if (!isExpanded) {
    return (
      <motion.div
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        className={cn("fixed bottom-6 right-6 z-50", className)}
      >
        <DockBar onToggle={onToggle} />
      </motion.div>
    )
  }

  return (
    <div className="flex items-center justify-center w-full">
      <InputForm
        input={input}
        onInputChange={onInputChange}
        isTyping={isTyping}
        inputRef={inputRef}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

function DockBar({ onToggle }: { onToggle: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={onToggle}
      className="flex h-14 w-14 items-center justify-center rounded-full cursor-pointer select-none active:scale-90 transition-transform"
    >
      <ColorOrb dimension="44px" tones={{ base: "oklch(22.64% 0 0)" }} />
    </button>
  )
}

function InputForm({
  input,
  onInputChange,
  isTyping,
  inputRef,
  onKeyDown,
}: {
  input: string
  onInputChange: (value: string) => void
  isTyping: boolean
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
}) {
  function handleKeys(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown(e)
  }

  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col"
      >
        <textarea
          ref={inputRef as React.Ref<HTMLTextAreaElement>}
          placeholder="..."
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          className="w-full resize-none rounded-md px-3 py-2.5 outline-none text-sm bg-transparent text-foreground placeholder-muted-foreground"
          onKeyDown={handleKeys}
          onInput={(e) => {
            const target = e.currentTarget
            target.style.height = "auto"
            target.style.height = `${Math.min(target.scrollHeight, 96)}px`
          }}
          style={{ minHeight: 44, maxHeight: 96 }}
          disabled={isTyping}
          spellCheck={false}
        />
      </motion.div>
    </div>
  )
}

export default MorphPanel
