import type { CardActionRecaptchaConfig } from "../card/actions/card-action-engine.js";

function nonBlankEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function recaptchaConfigFromHostEnv(
  env: Record<string, string | undefined>,
): CardActionRecaptchaConfig | undefined {
  const siteKey = nonBlankEnv(env.DECKO_RECAPTCHA_SITE_KEY);
  const secretKey = nonBlankEnv(env.DECKO_RECAPTCHA_SECRET_KEY);
  if (siteKey === undefined && secretKey === undefined) return undefined;

  const minimumScoreRaw = nonBlankEnv(env.DECKO_RECAPTCHA_MINIMUM_SCORE);
  let minimumScore: number | undefined;
  if (minimumScoreRaw !== undefined) {
    const parsed = Number(minimumScoreRaw);
    if (!Number.isFinite(parsed)) {
      throw new Error(
        `staging recaptcha env: DECKO_RECAPTCHA_MINIMUM_SCORE="${minimumScoreRaw}" ` +
          `is not a finite number — refusing to boot with a mis-armed guard`,
      );
    }
    minimumScore = parsed;
  }
  const verifyUrl = nonBlankEnv(env.DECKO_RECAPTCHA_VERIFY_URL);

  return {
    siteKey,
    secretKey,
    ...(minimumScore !== undefined ? { minimumScore } : {}),
    ...(verifyUrl !== undefined ? { verifyUrl } : {}),
  };
}
