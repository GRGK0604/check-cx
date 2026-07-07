import {cn} from "@/lib/utils";

/** 装饰用的十字角标 */
export function CornerPlus({className}: {className?: string}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className={cn("absolute h-4 w-4 text-muted-foreground/40", className)}
    >
      <line x1="12" y1="0" x2="12" y2="24" />
      <line x1="0" y1="12" x2="24" y2="12" />
    </svg>
  );
}
