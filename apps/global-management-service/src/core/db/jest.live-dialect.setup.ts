// Entity decorators read DB_TYPE when the db-dialect module loads; the live
// helper reads LIVE_DB_TYPE. In a Jest run both must agree, so a two-engine
// live spec exports LIVE_DB_TYPE and this file mirrors it into DB_TYPE before
// any test module (and its entities) is imported.
if (process.env.LIVE_DB_TYPE) process.env.DB_TYPE = process.env.LIVE_DB_TYPE;
