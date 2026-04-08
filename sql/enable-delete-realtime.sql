-- Enable DELETE events in Realtime for creatives table
-- Run in Supabase SQL Editor

ALTER TABLE creatives REPLICA IDENTITY FULL;
