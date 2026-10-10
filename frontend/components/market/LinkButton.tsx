/*
 * A next/link styled like the design-system Button (a <button> inside <a> is invalid HTML).
 * Uses the Button's own classes (buttonClass). No hooks: renders in Server Components too.
 */
import Link from "next/link";

import { buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui/primitives";

export function LinkButton({
  href,
  children,
  variant = "outline",
  size = "sm",
  className,
  title,
}: {
  href: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  title?: string;
}) {
  return (
    <Link href={href} title={title} prefetch={false} className={buttonClass(variant, size, `whitespace-nowrap ${className ?? ""}`)}>
      {children}
    </Link>
  );
}
