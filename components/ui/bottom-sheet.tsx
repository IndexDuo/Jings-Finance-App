"use client";

import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { tokens } from "@/styles/tokens";

// iOS-style bottom sheet.
// Built on Framer Motion + a portal-less fixed overlay. Focus trap: focuses
// the first interactive element on open, restores focus on close.
// Drag-to-dismiss threshold: 100px down OR velocity > 500.

export interface BottomSheetProps {
    open: boolean;
    onClose: () => void;
    title?: ReactNode;
    ariaLabel?: string;
    children: ReactNode;
    className?: string;
    contentClassName?: string;
    autoFocusFirstElement?: boolean;
}

const DRAG_CLOSE_DISTANCE = 100;
const DRAG_CLOSE_VELOCITY = 500;

export function BottomSheet({
    open,
    onClose,
    title,
    ariaLabel,
    children,
    className,
    contentClassName,
    autoFocusFirstElement = true,
}: BottomSheetProps) {
    const sheetRef = useRef<HTMLDivElement>(null);
    const restoreFocusRef = useRef<Element | null>(null);

    useEffect(() => {
        if (!open) return;
        restoreFocusRef.current = document.activeElement;
        const node = sheetRef.current;
        if (!node) return;
        if (autoFocusFirstElement) {
            const focusable = node.querySelector<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            );
            focusable?.focus();
        } else {
            node.focus();
        }
        return () => {
            (restoreFocusRef.current as HTMLElement | null)?.focus?.();
        };
    }, [open, autoFocusFirstElement]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            if (e.key !== "Tab") return;
            const sheet = sheetRef.current;
            if (!sheet) return;
            const controls = [...sheet.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
                .filter(element => element.getClientRects().length > 0);
            const first = controls[0], last = controls.at(-1);
            if (!first) { e.preventDefault(); sheet.focus(); return; }
            if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
                e.preventDefault(); last?.focus();
            } else if (!e.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) {
                e.preventDefault(); first.focus();
            }
        };
        window.addEventListener("keydown", onKey);
        // Prevent background scroll while open.
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [open, onClose]);

    const onDragEnd = (
        _: MouseEvent | TouchEvent | PointerEvent,
        info: PanInfo,
    ) => {
        if (
            info.offset.y > DRAG_CLOSE_DISTANCE ||
            info.velocity.y > DRAG_CLOSE_VELOCITY
        ) {
            onClose();
        }
    };

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        key="backdrop"
                        className="fixed inset-0 bg-black/25 z-40"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        aria-hidden
                    />
                    <motion.div
                        key="sheet"
                        ref={sheetRef}
                        tabIndex={-1}
                        role="dialog"
                        aria-modal="true"
                        aria-label={ariaLabel ?? (typeof title === "string" ? title : "Sheet")}
                        className={cn(
                            "fixed left-0 right-0 bottom-0 z-50 box-border w-full max-w-full bg-system-bg",
                            "max-h-[90dvh] flex flex-col overflow-x-hidden outline-none",
                            "shadow-[0_-10px_40px_rgba(0,0,0,0.12)]",
                            className,
                        )}
                        style={{
                            borderTopLeftRadius: 24,
                            borderTopRightRadius: 24,
                            touchAction: "pan-y",
                            marginBottom: 0,
                        }}
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={tokens.spring.stiff}
                        drag="y"
                        dragDirectionLock
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={{ top: 0, bottom: 0.6 }}
                        onDragEnd={onDragEnd}
                    >
                        <div className="flex items-center justify-center pt-2 pb-1 touch-none">
                            <span className="w-9 h-[5px] rounded-pill bg-tertiary-label" />
                        </div>
                        {title && (
                            <div className="px-5 pb-3">
                                <h2 className="text-[17px] font-semibold text-label">
                                    {title}
                                </h2>
                            </div>
                        )}
                        <div
                            className={cn(
                                "min-w-0 max-w-full flex-1 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom,16px)+16px)]",
                                "overflow-x-hidden",
                                contentClassName,
                            )}
                        >
                            {children}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
