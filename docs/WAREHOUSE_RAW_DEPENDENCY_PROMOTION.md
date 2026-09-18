# Warehouse Raw-Dependency Promotion (Dual Write / Dual Read)

`CampaignMetric.rawData` is not pruned by this phase. New ingestion dual-writes
production fields trapped in raw payloads to typed nullable columns; readers
prefer the promoted columns with a legacy rawData fallback. Historical rows are
never backfilled here and render exactly as before.

## Promoted field map

| Raw field | Provider | Writer | Reader/output | Promoted column | Type | Fallback |
| --------- | -------- | ------ | ------------- | --------------- | ---- | -------- |
| `ad_name` | meta_ads | `ingestMetaRows` → `upsertMetaMetric` | warehouse `adName` | `adName` | TEXT, nullable | parse rawData |
| `broad_metrics.orders` | shopee (product daily) | product mapper → `upsertCampaignMetric` | `broadOrders` (was `m.conversions`) | `shopeeBroadOrders` | DOUBLE PRECISION, nullable | raw → `m.conversions` |
| `broad_metrics.units_sold` | shopee (product daily) | product mapper → `upsertCampaignMetric` | `broadUnits` (was resolved broad) | `shopeeBroadUnits` | DOUBLE PRECISION, nullable | raw → resolved broad |
| `broad_metrics.gmv` | shopee (product daily) | product mapper → `upsertCampaignMetric` | `broadGmv` (was `m.revenue`) | `shopeeBroadGmv` | DOUBLE PRECISION, nullable | raw → `m.revenue` |
| `direct_metrics.orders` | shopee (product daily) | product mapper → `upsertCampaignMetric` | `directOrders` (was `0`) | `shopeeDirectOrders` | DOUBLE PRECISION, nullable | raw → `0` |
| `direct_metrics.units_sold` | shopee (product daily) | product mapper → `upsertCampaignMetric` | `directUnits` (was `0`) | `shopeeDirectUnits` | DOUBLE PRECISION, nullable | raw → `0` |
| `direct_metrics.gmv` | shopee (product daily) | product mapper → `upsertCampaignMetric` | `directGmv` (was `0`) | `shopeeDirectGmv` | DOUBLE PRECISION, nullable | raw → `0` |
| `keyword_settings_count` | shopee (product daily) | product mapper → `upsertCampaignMetric` | `keywordSettingsCount` (was `0`) | `shopeeKeywordSettingsCount` | INTEGER, nullable | raw → `0` |

Deliberately excluded: recomputed ratios (broad/direct ROAS, ACOS, CR, cost per
conversion — the route recomputes them), the `keyword_settings` array (only the
count is read), `metric_raw` and other debug blobs, provenance markers
(`source`, `metric`, `mode`, `revenue_basis`, `region`), and identity fields
already normalized (`campaignId`, `campaignName`, item names in `adsetName`).
v2 CPC rows carry no broad/direct objects, so the mapper stores
display-canonical broad values identical to the legacy fallbacks while direct
and keyword signals stay NULL (unknown, not zero).

## Dual-write behavior

- Meta: `ingestMetaRows` extracts `row.ad_name`, normalizes it with
  `normalizeMetaAdName` (trimmed non-empty kept verbatim, else NULL — exactly
  the legacy reader rule), and `upsertMetaMetric` writes it on create and
  conflict-update. Unique key, breakdown hash, fencing, sync job, and
  campaign-grain deduplication are unchanged. Only Meta ingestion sets
  `adName`; the generic `upsertCampaignMetric` never touches it.
- Shopee Ads: both mappers populate the seven columns (`numOrNull` preserves
  absent as NULL and zero as zero; non-finite garbage becomes NULL instead of
  poisoning totals with NaN). `rawData` is preserved byte-identical. Chunk
  size, heartbeat, fencing, and error accounting are unchanged. Google, TikTok,
  Lazada, and marketplace rollups are behaviorally unchanged.

## Promoted-first fallback order

- Warehouse Meta ad name: promoted `adName` when non-null and non-empty, else
  legacy safe rawData parse, else null. An empty promoted value can never be a
  valid legacy output, so it falls back too.
- Shopee performance: per field independently, promoted column when non-null,
  else legacy rawData field, else the pre-existing normalized/zero fallback.
  Explicit nullish checks only — zero stays valid. Response shape is backward
  compatible; all ratios are still computed from resolved values as before.

## Legacy compatibility

Nullable columns keep every historical row readable: NULL promoted values flow
into the exact legacy fallback chains, including malformed-JSON safety.
Reports, exports, AI sanitization, and data-quality schema checks are
unchanged (promoted columns are outside the reporting allowlist).

## Why backfill is still required, and why pruning is blocked

Dual write covers only rows ingested after this deploy. Every older row still
depends on rawData, so pruning today would break the warehouse ad dimension
and Shopee broad/direct/keyword reporting. `classifyRawDependencyReadiness`
(counts only, never payloads) tracks raw-dependent vs promoted rows per
workspace as evidence for the next phase.

Proposed next phase: bounded idempotent backfill with checkpoints that fills
promoted columns from rawData in small batches, reusing the same fallback
chains as oracle. Rollback here is a code revert: new columns stay NULL and
readers behave exactly as before. Bulk ingestion and retention execution are
explicitly out of scope.
