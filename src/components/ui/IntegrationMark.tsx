import { cn } from "@/lib/utils";

const SIZE = {
    sm: { box: "h-7 w-7", img: 14 },
    md: { box: "h-9 w-9", img: 18 },
    lg: { box: "h-11 w-11", img: 22 },
} as const;

/**
 * Brand marks sit on a white tile so black SVGs (TikTok, Meta) stay readable
 * on canvas/panel, and color marks (Google, Shopee) stay consistent.
 */
export function IntegrationMark({
    src,
    alt = "",
    size = "md",
    className,
}: {
    src: string;
    alt?: string;
    size?: keyof typeof SIZE;
    className?: string;
}) {
    const s = SIZE[size];
    return (
        <span
            className={cn(
                "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-white",
                s.box,
                className,
            )}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} width={s.img} height={s.img} className="object-contain" />
        </span>
    );
}
