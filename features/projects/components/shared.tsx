export const card = "rounded-card border border-black/5 bg-system-bg shadow-ios-card overflow-hidden";
export const field = "mt-2 w-full rounded-button bg-secondary-system-bg px-4 py-3 text-base text-label outline-system-blue";
export const primary = "min-h-12 w-full rounded-button bg-system-blue px-4 py-3 font-semibold text-white disabled:opacity-50";
export const sheetWidth = "sm:mx-auto sm:max-w-[520px]";
export const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export const rememberKey = (userId: string) => `projects:last:${userId}`;
