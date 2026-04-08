-- Enable Realtime for creatives and pipeline_log tables
-- Run this in Supabase SQL Editor

ALTER PUBLICATION supabase_realtime ADD TABLE creatives;
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_log;
