import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

export type ButtonVariant = "primary" | "default" | "subtle";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  ref?: Ref<HTMLButtonElement>;
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
