import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
    verifyMetaWebhookChallenge,
    verifyMetaWebhookSignature,
    handleMetaWebhookPayload,
    type MetaWebhookPayload,
} from "./meta-webhooks";

describe("Meta Ads Webhooks Engine", () => {
    it("verifies GET challenge with valid verify token", () => {
        process.env.META_WEBHOOK_VERIFY_TOKEN = "test_meta_token_123";

        const validParams = new URLSearchParams({
            "hub.mode": "subscribe",
            "hub.verify_token": "test_meta_token_123",
            "hub.challenge": "challenge_string_abc_123",
        });

        const challenge = verifyMetaWebhookChallenge(validParams);
        assert.equal(challenge, "challenge_string_abc_123");

        const invalidParams = new URLSearchParams({
            "hub.mode": "subscribe",
            "hub.verify_token": "wrong_token",
            "hub.challenge": "challenge_string_abc_123",
        });

        assert.equal(verifyMetaWebhookChallenge(invalidParams), null);
    });

    it("verifies HMAC-SHA256 signature for POST body", () => {
        const secret = "test_meta_app_secret";
        process.env.META_ADS_APP_SECRET = secret;

        const body = JSON.stringify({ object: "page", entry: [] });
        const hmac = crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
        const validHeader = `sha256=${hmac}`;

        assert.equal(verifyMetaWebhookSignature(body, validHeader), true);

        const tamperedHeader = `sha256=1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`;
        assert.equal(verifyMetaWebhookSignature(body, tamperedHeader), false);
    });

    it("processes leadgen event payload properly", async () => {
        const testPayload: MetaWebhookPayload = {
            object: "page",
            entry: [
                {
                    id: "page_123",
                    time: Date.now(),
                    changes: [
                        {
                            field: "leadgen",
                            value: {
                                leadgen_id: "lead_456",
                                page_id: "page_123",
                                form_id: "form_789",
                                ad_id: "ad_101",
                                created_time: 1724000000,
                            },
                        },
                    ],
                },
            ],
        };

        const result = await handleMetaWebhookPayload(testPayload);
        assert.equal(result.processed, 1);
        assert.equal(result.leads, 1);
        assert.equal(result.alerts, 0);
    });
});
