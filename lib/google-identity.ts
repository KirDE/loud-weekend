import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import { z } from "zod";

const googleIssuer = "https://accounts.google.com";
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), {
  timeoutDuration: 5_000,
});
const claimSchema = z.object({
  sub: z.string().regex(/^[\x21-\x7e]{1,255}$/),
  email: z.email().max(254),
  email_verified: z.literal(true),
  nonce: z.string(),
  azp: z.string().optional(),
});

export async function verifyGoogleIdentity(
  idToken: string,
  { clientId, nonce }: { clientId: string; nonce: string },
  keys: JWTVerifyGetKey = googleKeys,
) {
  if (!clientId || !nonce || idToken.length > 16_384) throw new Error("Invalid Google identity.");
  const { payload } = await jwtVerify(idToken, keys, {
    algorithms: ["RS256"],
    audience: clientId,
    issuer: [googleIssuer, "accounts.google.com"],
    requiredClaims: ["iss", "sub", "aud", "exp", "iat", "nonce"],
    maxTokenAge: "10 minutes",
    clockTolerance: 10,
  });
  const claims = claimSchema.safeParse(payload);
  if (
    !claims.success ||
    claims.data.nonce !== nonce ||
    payload.aud !== clientId ||
    (claims.data.azp !== undefined && claims.data.azp !== clientId)
  ) {
    throw new Error("Invalid Google identity.");
  }
  return { subject: claims.data.sub, email: claims.data.email.toLowerCase() };
}
