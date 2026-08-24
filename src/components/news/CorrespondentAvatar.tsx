import type { PersonaId } from '../../news-types';
import { getCorrespondent } from '../../newsroom/correspondents';

/**
 * The correspondent's visual identity.
 *
 * Generated marks only — concentric sweeps standing for a light, a signal or a
 * current. Never a face, never anything a reader could mistake for a
 * photograph of a person.
 *
 * This is a **published public commitment**, not a style preference: the
 * AI-use policy states in section 4 that "avatars are abstract marks. We will
 * never use a synthetic human face." It cannot be traded away for visual
 * appeal, and `tests/correspondents.test.tsx` asserts it for all five.
 */

interface Props {
  id: PersonaId;
  size?: number;
  className?: string;
}

/** Small deterministic hash so a correspondent's mark never changes between renders. */
function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function CorrespondentAvatar({ id, size = 40, className }: Props) {
  const correspondent = getCorrespondent(id);
  if (!correspondent) return null;

  const { hue, name } = correspondent;
  const seed = hash(id);
  const rings = 3 + (seed % 3);
  const rotation = seed % 360;
  const gradientId = `pb-avatar-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={`Abstract generated mark for ${name}. Not a photograph of a person.`}
      focusable="false"
    >
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor={`hsl(${hue} 85% 62%)`} />
          <stop offset="100%" stopColor={`hsl(${hue} 60% 16%)`} />
        </radialGradient>
      </defs>

      <rect width="64" height="64" rx="14" fill="#0b1220" />
      <rect width="64" height="64" rx="14" fill={`url(#${gradientId})`} opacity="0.22" />

      <g transform={`rotate(${rotation} 32 32)`}>
        {/* The sweep: a beam, a scan, a current — depending on the beat. */}
        <path d="M32 32 L62 20 A32 32 0 0 1 62 44 Z" fill={`hsl(${hue} 90% 65%)`} opacity="0.35" />

        {Array.from({ length: rings }, (_, index) => {
          const radius = 8 + index * 7;
          return (
            <circle
              key={radius}
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              stroke={`hsl(${hue} 85% ${72 - index * 8}%)`}
              strokeWidth={index === 0 ? 3 : 1.25}
              strokeDasharray={index === 0 ? undefined : `${4 + index * 3} ${3 + index * 2}`}
              opacity={0.9 - index * 0.13}
            />
          );
        })}
      </g>

      <circle cx="32" cy="32" r="3" fill={`hsl(${hue} 95% 82%)`} />
      <rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        rx="13.5"
        fill="none"
        stroke={`hsl(${hue} 60% 55%)`}
        strokeOpacity="0.4"
      />
    </svg>
  );
}
