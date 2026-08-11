-- Garmin integration removed (unreliable in practice). Drops the stored
-- (encrypted) Garmin Connect credentials along with the table.
drop table if exists garmin_connections;
