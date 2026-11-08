-- Watermarked public copies of photos. The original stays private (admin-only) while the
-- watermark is on; wm_sig records which watermark settings produced the copy, so a change of
-- text/position/size/opacity marks older copies as stale.
ALTER TABLE media ADD COLUMN IF NOT EXISTS wm_key text;
ALTER TABLE media ADD COLUMN IF NOT EXISTS wm_mime text;
ALTER TABLE media ADD COLUMN IF NOT EXISTS wm_sig text;
