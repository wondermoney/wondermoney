import { NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/utils/env";
import { canBypassRecaptchaForE2E } from "@/lib/utils/recaptcha-e2e-bypass";

const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
const RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const MIN_SCORE = 0.5;

function canBypassRecaptchaConfiguration() {
  return canBypassRecaptchaForE2E({
    appUrl: env.NEXT_PUBLIC_APP_URL,
    bypassFlag: env.E2E_BYPASS_RECAPTCHA,
    vercelEnv: process.env.VERCEL_ENV,
  });
}

interface RecaptchaResponse {
  success: boolean;
  score: number;
  action: string;
  challenge_ts: string;
  hostname: string;
  "error-codes"?: string[];
}

export interface RecaptchaVerifyResponse {
  success: boolean;
  score?: number;
  action?: string;
  hostname?: string;
  errorCodes?: string[];
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { token?: string; forceFailure?: boolean };
    const { token, forceFailure } = body;

    // Allow forcing failure in development for testing
    if (forceFailure && process.env.NODE_ENV === "development") {
      return NextResponse.json<RecaptchaVerifyResponse>(
        {
          success: false,
          error: "Forced failure for testing",
          score: 0.1,
          action: "signup",
        },
        { status: 400 },
      );
    }

    if (canBypassRecaptchaConfiguration()) {
      return NextResponse.json<RecaptchaVerifyResponse>({
        success: true,
        score: 1,
        action: "non_production_bypass",
      });
    }

    if (!token) {
      return NextResponse.json<RecaptchaVerifyResponse>(
        { success: false, error: "Token is required" },
        { status: 400 },
      );
    }

    if (!RECAPTCHA_SECRET_KEY) {
      return NextResponse.json<RecaptchaVerifyResponse>(
        { success: false, error: "reCAPTCHA is not configured" },
        { status: 503 },
      );
    }

    const response = await fetch(RECAPTCHA_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `secret=${RECAPTCHA_SECRET_KEY}&response=${token}`,
    });

    const data = (await response.json()) as RecaptchaResponse;

    if (!data.success) {
      return NextResponse.json<RecaptchaVerifyResponse>(
        {
          success: false,
          error: "reCAPTCHA verification failed",
          errorCodes: data["error-codes"],
        },
        { status: 400 },
      );
    }

    if (data.score < MIN_SCORE) {
      return NextResponse.json<RecaptchaVerifyResponse>(
        {
          success: false,
          error: "Low reCAPTCHA score",
          score: data.score,
          action: data.action,
          hostname: data.hostname,
        },
        { status: 400 },
      );
    }

    return NextResponse.json<RecaptchaVerifyResponse>({
      success: true,
      score: data.score,
      action: data.action,
      hostname: data.hostname,
    });
  } catch (error) {
    console.error("reCAPTCHA verification error");
    return NextResponse.json<RecaptchaVerifyResponse>(
      { success: false, error: "Verification failed" },
      { status: 500 },
    );
  }
}
