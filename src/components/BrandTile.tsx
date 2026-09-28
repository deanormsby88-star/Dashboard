import BrandMark from "@/components/BrandMark";

/**
 * The Second app-icon tile: the S mark on a deep-navy rounded square (brand
 * asset: SECOND-app-icon-dark). Reads the same on the light and dark canvas.
 */
export default function BrandTile({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const box = {
    sm: "h-9 w-9 rounded-xl",
    md: "h-12 w-12 rounded-2xl",
    lg: "h-16 w-16 rounded-[1.35rem]",
  }[size];
  const mark = { sm: "h-5 w-5", md: "h-7 w-7", lg: "h-9 w-9" }[size];
  return (
    <div
      className={`flex shrink-0 items-center justify-center border border-white/10 bg-[#0b1220] shadow-[0_6px_24px_-6px_rgba(92,51,245,0.55)] ${box}`}
    >
      <BrandMark className={mark} />
    </div>
  );
}
