// The entity decorators read DB_TYPE at import time; a live spec that runs on
// both engines sets LIVE_DB_TYPE, and this copies it into DB_TYPE so the
// decorators and the live helper agree.
if (process.env.LIVE_DB_TYPE) process.env.DB_TYPE = process.env.LIVE_DB_TYPE;
