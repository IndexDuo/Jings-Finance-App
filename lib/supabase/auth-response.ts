import { NextResponse } from "next/server";

/** Relative destinations preserve the browser's origin through reverse proxies. */
export function authResponse(destination: string) {
  return new NextResponse(null, { status: 303, headers: {
    Location: destination, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
  } });
}
