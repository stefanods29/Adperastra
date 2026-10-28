import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "default" | "subtle";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export default function Button({ variant = "default", children, className, ...rest }: ButtonProps) {
  const cls = ["adp-btn", `adp-btn--${variant}`, className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}
