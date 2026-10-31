/** The informational strength estimate from Step 06e D9. It never changes
 * which encryption is offered: weak, fair or strong, no cryptographic claim. */

export type PasswordStrength = "weak" | "fair" | "strong";

/** How many different characters a password uses. */
export function distinctCharacters(value: string): number {
  return new Set(Array.from(value)).size;
}

export function passwordStrength(value: string): PasswordStrength {
  const distinct = distinctCharacters(value);
  if (value.length < 8 || distinct < 4) return "weak";
  if (value.length >= 16 && distinct >= 8) return "strong";
  return "fair";
}

/** A stable 0 to 3 value for the meter (weak 1, fair 2, strong 3). */
export function passwordStrengthValue(value: string): number {
  switch (passwordStrength(value)) {
    case "weak":
      return 1;
    case "fair":
      return 2;
    case "strong":
      return 3;
  }
}
