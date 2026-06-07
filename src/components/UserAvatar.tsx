/* eslint-disable @next/next/no-img-element */

// Shared avatar: the Google photo, or a gradient person fallback.
export function UserAvatar({
  image,
  className = "h-9 w-9",
}: {
  image: string | null;
  className?: string;
}) {
  if (image) {
    return (
      <img
        src={image}
        alt=""
        className={`${className} rounded-full`}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={`${className} rounded-full`} aria-hidden>
      <defs>
        <linearGradient id="uavBg" gradientUnits="userSpaceOnUse" x1="4" y1="20" x2="20" y2="4">
          <stop offset="0%" stopColor="#1E5FCF" />
          <stop offset="100%" stopColor="#1FB8B0" />
        </linearGradient>
        <linearGradient id="uavPerson" gradientUnits="userSpaceOnUse" x1="12" y1="6" x2="12" y2="23">
          <stop offset="0%" stopColor="#6FE0EA" />
          <stop offset="100%" stopColor="#2E84F5" />
        </linearGradient>
        <clipPath id="uavClip">
          <circle cx="12" cy="12" r="12" />
        </clipPath>
      </defs>
      <circle cx="12" cy="12" r="12" fill="url(#uavBg)" />
      <g clipPath="url(#uavClip)" fill="url(#uavPerson)">
        <circle cx="12" cy="9" r="3.1" />
        <path d="M4.6 23.6 A7.4 8.6 0 0 1 19.4 23.6 Z" />
      </g>
    </svg>
  );
}
