import { ImageResponse } from "next/og";

/** Neutral placeholder icon. Vector paths avoid remote fonts and emoji CDNs. */
export function appIcon(size: number) {
  return new ImageResponse(<svg width={size} height={size} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="22" fill="#007AFF"/>
    <path d="M65 30C60 25 40 25 35 35C25 55 75 45 65 65C60 75 40 75 35 70M50 19V81"
      fill="none" stroke="white" strokeWidth="7" strokeLinecap="round"/>
  </svg>, {width:size,height:size});
}
