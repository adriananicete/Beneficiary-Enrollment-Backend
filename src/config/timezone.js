// This process runs on Philippine time, set here before anything reads a
// clock.
//
// The database writes every datetime with GETDATE(), and SQL Server runs at
// +08:00. Measured 2026-10-06: GETDATE() 13:23:47, GETUTCDATE() 05:23:47,
// SYSDATETIMEOFFSET() +08:00. db.js reads those values with useUTC: false,
// which interprets them in THIS process's time zone. So the process has to be
// on Philippine time, whatever the host machine is set to. UAT and production
// hosts are not known, and servers are often UTC; on a UTC host every time
// would come out eight hours wrong.
//
// Set in code rather than left to each server's configuration, so that no
// server can forget it. env.js imports this first and checks that it took.
//
// The Philippines has kept one offset all year since 1978, so a single check
// of the offset is a complete one.
process.env.TZ = "Asia/Manila";
