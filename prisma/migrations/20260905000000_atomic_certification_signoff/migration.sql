-- Additive: never rewrite legacy evidence or infer an approval.
ALTER TABLE "EvidencePackRecord" ADD COLUMN "certifiedPack" JSONB;
