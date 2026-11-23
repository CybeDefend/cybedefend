// One line, run before any test module loads: when a live spec selects its
// engine with LIVE_DB_TYPE, the entity decorators (which read DB_TYPE at
// import time through @cybedefend/db-dialect) and the live helper must agree.
if (process.env.LIVE_DB_TYPE) process.env.DB_TYPE = process.env.LIVE_DB_TYPE;
