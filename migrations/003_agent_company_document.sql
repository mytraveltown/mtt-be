-- Agent company verification: one document (type + uploaded file) replaces the CIN / GST number inputs.
-- cin_no and gst_no are kept so existing agents' data is not lost.
-- Back up the `agent` table before running on production.

ALTER TABLE agent
  ADD COLUMN company_document_type VARCHAR(50) NULL AFTER gst_no,
  ADD COLUMN company_document VARCHAR(255) NULL AFTER company_document_type;
